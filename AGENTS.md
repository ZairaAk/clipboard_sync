# AGENTS.md — Universal Clipboard Sync (Desktop Only)

This file captures the rules and scope described in `PLANS.md`.

## Non-negotiable guardrails
- Spec-first, code-second; only implement exactly what `PLANS.md` specifies.
- Every task must include exact paths, files, API shapes, message schemas (from `packages/protocol`), acceptance criteria, and tests + how to run them.
- No extra message types/endpoints/UI screens beyond the plan.
- Keep work in small modules; never "build the whole app" in one ask.
- Pinned versions: Node 20.x, pnpm 9.12.0, TypeScript 5.5.4, ws 8.18.0, Electron 32.2.0, Vite 5.4.8, React 18.3.1.
- Protocol lives in `packages/protocol` and must be imported elsewhere (single truth source).
- Server must never see clipboard payload; payload travels only over WebRTC DataChannel.
- Electron security: no `remote`, `contextIsolation: true`, preload + IPC, OS operations in main.
- Tests required after every phase; update `docs/TESTING.md` with commands + manual verification.

## Repo layout (fixed)
```
universal-clipboard/
  apps/desktop/
  packages/server/
  packages/protocol/
  docs/
  PLANS.md
  pnpm-workspace.yaml
  package.json
  .nvmrc
```

## Product rules
- Pairing codes are required for any connection; 6-digit numeric strings.
- Desktop app must maintain clipboard history with no duplicates.
- History dedupe key: `(mime + contentHash)`; on duplicate, update `lastSeen`, move to top, no new entry.
- Max history size: `HISTORY_MAX_ITEMS = 200` (configurable).

## Protocol v1 (shared contract)
- WebSocket control-plane messages:
  - Client → Server: `hello`, `heartbeat`, `list_devices`, `signal`, `pair_create`, `pair_join`.
  - Server → Client: `devices_update`, `signal`, `pair_created`, `pair_paired`.
  - Error message: `{ "type":"error", "code":"...", "message":"..." }`.
- `deviceId` is a UUID v4 string in lowercase canonical form with hyphens, generated once on first run and persisted.
- P2P DataChannel payload message:
  - `clip_event` with `eventId`, `originDeviceId`, `timestampMs`, `mime`, `nonce`, `ciphertext`.
- `clip_event` is the **only** P2P top-level message type in protocol.
- Chunking (`meta`/`chunk`/`done`) is a JSON payload that is:
  - `JSON.stringify` → encrypted → stored in `clip_event.ciphertext`.
  - On receive: decrypt → `JSON.parse` → handle by `kind`.
- Chunking payload union shape (inside decrypted ciphertext):
  - Meta:
    ```
    {
    "kind":"meta",
    "transferId":"uuid",
    "mime":"image/png|application/octet-stream|...",
    "name":"optional filename",
    "sizeBytes":12345,
    "sha256":"base64",
    "totalChunks":12,
    "chunkSize":65536
    }
    ```
  - Chunk:
    ```
    {
    "kind":"chunk",
    "transferId":"uuid",
    "index":0,
    "bytes":"base64"
    }
    ```
  - Done:
    ```
    {
    "kind":"done",
    "transferId":"uuid"
    }
    ```
- `clip_event.mime` remains the real content type and is used for history/display/routing.
- Loop prevention:
  - Drop if `originDeviceId == self`.
  - Drop if `eventId` already seen (LRU).
  - Suppress local watcher for 500ms after applying remote clip.

## MVP scope
- Desktop-only real-time clipboard sync (at least 2 desktop OS).
- Secure transport via WebRTC DTLS; TURN required.
- Clipboard content types: `text/plain`, images (PNG), files.
- Pairing codes required; clipboard history with no duplicates.
- Explicitly not in MVP: offline queue, mesh, cloud storage/relay of clipboard content.
- No clipboard payload over WebSocket; DataChannel only.

## Phased build plan (order must not change)
1. `packages/protocol`: schemas/validators + tests for pairing + clip_event.
2. `packages/server`: presence + pairing + signaling relay + tests.
3. `apps/desktop` skeleton: WS + clipboard watcher + history + tests.
4. WebRTC handshake + TURN.
5. Text sync.
6. Image chunking.
7. File transfer.

## Clipboard history data model (desktop)
- Fields: `id`, `mime`, `contentHash`, `preview`, `sizeBytes`, `firstSeen`, `lastSeen`, `source`, `originDeviceId`.
- Dedupe key: `mime + contentHash`.
- Dedupe rule applies to all items (including files).
- For files:
  - `contentHash` = sha256(file bytes).
  - `mime` = detected mime, else `application/octet-stream`.
  - filename is metadata only (not part of dedupe).
  - If same `mime + contentHash` appears with a different name: update `lastSeen` and optionally update display name to most recent name (or keep a short list of recent names), but do not create a duplicate.
- Storage: in-memory for MVP (no persistence).

## Chunking + integrity
- Constants: `CHUNK_SIZE_BYTES = 65536`, `MAX_TRANSFER_BYTES` default 50MB.
- Logical structure: `meta`, `chunk`, `done` (before encryption), reassemble by index, verify SHA-256 before apply/save.

## WebRTC initiator rule
- Use lexicographic ASCII string compare of normalized lowercase `deviceId`.
- Initiator if `self.deviceId < peer.deviceId`, otherwise responder.

## Crypto key field (MVP)
- `publicKey` is X25519, base64 of raw 32-byte key (no PEM, no hex).
- In MVP, store/validate/pass-through only; no E2EE handshake yet (DTLS only).

## Testing & verification
- Maintain `docs/TESTING.md` with phase-by-phase commands, manual checks, known limits.
- Each package/app must include a `test` script; prefer `node:test` for TS when possible.
- Phase 5 manual test should respect `MAX_TRANSFER_BYTES` (default 50MB) unless the limit is explicitly changed.
