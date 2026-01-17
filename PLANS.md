# PLANS.md — Universal Clipboard Sync (Desktop Only: Electron + TS)

> **Purpose:** Single source of truth for Codex CLI.
> **Rule:** Spec-first, code-second. Codex must implement *exactly* what’s specified here. No extra features.

---

## 0) Non-Negotiable Guardrails

1. **Spec-first, code-second**

* Every task must include:

  * exact folder path
  * exact file list
  * exact API/function shapes
  * exact message schemas (import from `packages/protocol`)
  * acceptance criteria
  * tests + how to run them
* **Do not invent additional message types, endpoints, or UI screens.**

2. **Small modules only**

* Never ask Codex: “build the whole app”.
* Always ask: “implement these files + these functions + these tests”.

3. **Pinned versions**

* **Node:** 20.x
* **pnpm:** 9.12.0
* **TypeScript:** 5.5.4
* **WebSocket lib:** ws@8.18.0
* **Electron:** 32.2.0
* **Vite:** 5.4.8
* **React:** 18.3.1

If Codex tries to change versions, reject the change.

4. **Protocol is one truth source**

* Protocol types/schemas live in `packages/protocol/`.
* Server and desktop apps must **import** and adhere to it.
* No duplicate schema definitions elsewhere.

5. **Security rule**

* **Server must never see clipboard payload.**
* Clipboard data must travel only over **WebRTC DataChannel** (P2P).
* WebSocket is **control-plane only** (presence + signaling + pairing codes).

6. **Electron security**

* No `remote` module.
* `contextIsolation: true`
* Preload + IPC for renderer ↔ main.
* All OS operations (clipboard, file I/O) in main process.

7. **Testing rule (mandatory)**

* After **every phase**, Codex must add:

  * unit/integration tests
  * a `docs/TESTING.md` update describing how to run and verify manually
* No “TODO tests later”.

---

## 1) Repo Layout (Fixed)

```
universal-clipboard/
  apps/
    desktop/              # Electron + TS (Windows/Linux/macOS)
  packages/
    server/               # Node WS: presence + signaling + pairing codes
    protocol/             # JSON schemas + constants (single truth source)
  docs/
  PLANS.md
  pnpm-workspace.yaml
  package.json
  .nvmrc
```

---

## 2) Product Rules

### 2.1 Pairing

* **Connections between laptops/desktops are made via pairing codes.**
* Pairing is **required** before any WebRTC connection.

### 2.2 Clipboard History (Desktop Required)

* **Clipboard history must be present on Desktop.**
* History must have **no duplicates** (dedupe rules below).

### 2.3 History Dedup Rules

* History items are deduped by `(mime + contentHash)`.
* If a new item matches an existing one:

  * update its `lastSeen` timestamp
  * move it to top (most recent)
  * do NOT create a duplicate entry
* Maintain max history size: `HISTORY_MAX_ITEMS = 200` (configurable).

---

## 3) Protocol v1 (Shared Contract)

### 3.1 WebSocket (Control Plane) Messages

**Client → Server**

```json
{ "type":"hello", "deviceId":"...", "deviceName":"...", "platform":"windows|mac|linux", "publicKey":"base64" }
{ "type":"heartbeat", "deviceId":"...", "ts": 1730000000000 }
{ "type":"list_devices" }
{ "type":"signal", "to":"deviceId", "from":"deviceId", "payload": { "kind":"offer|answer|ice", "data":{} } }
```

**Pairing codes**

* Pair codes are **6-digit numeric** strings: `000000`–`999999`.

**Client → Server (pairing)**

```json
{ "type":"pair_create", "deviceId":"..." }
{ "type":"pair_join", "deviceId":"...", "code":"123456" }
```

**Server → Client (pairing)**

```json
{ "type":"pair_created", "deviceId":"...", "code":"123456", "expiresAt": 1730000000000 }
{ "type":"pair_paired", "a":"deviceId", "b":"deviceId" }
```

**Server → Client**

```json
{ "type":"devices_update", "devices":[ { "deviceId":"...", "deviceName":"...", "platform":"windows|mac|linux", "status":"online|offline", "lastSeen": 1730000000000, "publicKey":"base64" } ] }
{ "type":"signal", "to":"...", "from":"...", "payload": { "kind":"offer|answer|ice", "data":{} } }
```

**Internal server error message (minimal)**

```json
{ "type":"error", "code":"...", "message":"..." }
```

### 3.2 P2P DataChannel Messages (Clipboard Payload)

```json
{
  "type": "clip_event",
  "eventId": "uuid",
  "originDeviceId": "deviceId",
  "timestampMs": 1730000000000,
  "mime": "text/plain",
  "nonce": "base64",
  "ciphertext": "base64"
}

**Encryption:**

* No app-level payload encryption required in MVP (DTLS only).

**Text payload encoding (MVP):**

* For `mime: "text/plain"`, set `ciphertext` to base64 of UTF-8 text.
* `nonce` remains a base64 random string (unused in MVP).
```

### 3.3 Loop Prevention Rules (Mandatory)

* Drop if `originDeviceId == self`.
* Drop if `eventId` already seen (LRU cache, size 2000).
* Suppress local clipboard watcher for **500ms** after applying remote clip.

---

## 4) MVP Scope (Hackathon)

### Required for submission

* Real-time / near-real-time clipboard sync across at least 2 desktop OS.
* Secure transport (WebRTC DTLS).
* TURN required (connect across networks).
* Support clipboard content types:

  * `text/plain`
  * images (normalize to PNG bytes)
  * files (transfer reliably; “true OS file clipboard paste” is best-effort)
  * videos treated as files (e.g., .mp4)

### Also required

* Pairing codes for laptop↔laptop connections
* Clipboard history with no duplicates

### Explicitly NOT in MVP

* Offline queue / persistence (live sync only).
* Multi-peer mesh (2 devices is fine).
* Cloud storage or server-relay of clipboard content.

---

## 5) Build Plan (Phases + Acceptance + Tests)

### Phase 0 — Project setup and contracts

**Goal:** repo boots; server runs; desktop launches; protocol defined.

**Deliverables**

* Monorepo structure
* `packages/protocol` implemented (types + zod validators)
* Include pairing message schemas in protocol (`pair_create/join`, `pair_created/paired`)
* Basic logging + error format

**Tests (must generate)**

* `packages/protocol` unit tests:

  * validates `hello`, `signal`, `pair_create`, `pair_join`, `pair_created`, `pair_paired`
  * validates `clip_event`

**How to test**

* `pnpm -C packages/protocol test`
* `pnpm -C packages/protocol build`

**Acceptance**

* `pnpm install` at repo root succeeds
* `pnpm dev` starts server + desktop without errors

---

### Phase 1 — Presence + Pairing + Signaling server (no payload)

**Goal:** devices online/offline; pairing codes; relay signaling only.

**Deliverables**

* WebSocket server supports:

  * `hello`, `heartbeat`, `list_devices`
  * pairing: `pair_create`, `pair_join`, `pair_created`, `pair_paired`
  * signaling relay: `signal` (offer/answer/ice)
* In-memory presence store (Map): online/offline + lastSeen + publicKey
* In-memory pair-code registry:

  * code → {creatorDeviceId, expiresAt}
  * once joined: emits `pair_paired` to both devices
* Rate limit: max 50 `signal` per 10s per socket
* DO NOT log SDP/ICE contents

**Tests (must generate)**

* `packages/server` tests using Node ws client:

  * two clients connect + send `hello`
  * `list_devices` returns both
  * `pair_create` returns 6-digit code
  * second client `pair_join` succeeds
  * server emits `pair_paired` to both
  * `signal` relays from A to B

**How to test**

* Automated:

  * `pnpm -C packages/server test`
* Manual:

  * run server: `pnpm -C packages/server dev`
  * run `packages/server/scripts/ws-smoke.ts` (generated) to connect two clients and print events

**Acceptance**

* Two clients register and see each other
* Pairing code flow works
* Signaling relays offer/answer/ice

---

### Phase 2 — WebRTC P2P connection (DataChannel up)

**Goal:** paired desktops establish a direct DataChannel connection.

**Deliverables**

* Pairing-triggered connection initiation:

  * only after `pair_paired` event
* Initiator rule (deterministic): smaller `deviceId` initiates offer
* State machine: `DISCONNECTED → CONNECTING → CONNECTED → FAILED`
* TURN configured on desktop (ICE servers list)

**Tests (must generate)**

* Desktop unit tests for state machine transitions
* Desktop integration test (mock signaling):

  * feed offer/answer/ice messages into webrtc module stubs
  * verify correct outgoing messages created
    NOTE: full WebRTC connectivity test may be manual due to environment.

**How to test**

* Manual:

  * run server + two desktop apps
  * pair using code
  * UI shows “Connected”
  * ping over DataChannel

**Acceptance**

* After pairing, UI shows “Connected”
* DataChannel ping A→B reliably (cross-network with TURN)

---

### Phase 3 — Clipboard text sync (cross-platform desktop)

**Goal:** copy text on one device, it appears on the other.

**Deliverables**

* Clipboard watcher (poll 300ms)
* Apply remote text to OS clipboard
* SQLite-backed history storage (persistent)
* Loop prevention:

  * suppress watcher for 500ms after apply
  * eventId LRU dedupe
* Clipboard history (no duplicates):

  * record both local and remote-applied items
  * dedupe by (mime + contentHash)
  * max 200 items

**Tests (must generate)**

* History unit tests:

  * insert unique items
  * re-insert same content updates lastSeen and moves to top
  * max size enforcement
* Loop prevention tests:

  * applying remote sets suppress flag
  * repeated eventId dropped

**How to test**

* Manual:

  * pair two desktop apps
  * copy text A → paste on B
  * verify history shows one entry, not duplicates
  * copy same text again → history updates existing item, not duplicate

**Acceptance**

* Copy/paste works both directions across Windows/macOS/Linux
* No loops
* History present with no duplicates

---

### Phase 4 — Clipboard images sync

**Goal:** copy image on A, it’s available on B.

**Deliverables**

* Detect image clipboard changes (desktop)
* Normalize to PNG bytes
* Chunked transfer protocol over DataChannel (encrypted inside clip_event)
* Reassemble on receiver
* Write to OS clipboard as image
* Record history entry for image (dedup by hash)

**Tests (must generate)**

* Chunker/reassembler unit tests:

  * meta/chunk/done flow
  * sha256 verification pass/fail
* History tests include image entries deduped by hash

**How to test**

* Manual:

  * copy image on desktop A → paste on desktop B
  * verify history contains image entry (no duplicates)

**Acceptance**

* Image copy/paste works between two desktops in common apps

---

### Phase 5 — Files sync (transfer first; clipboard integration later)

**Goal:** copy/select a file on A, B receives the file reliably.

**Deliverables**

* In-app “Send File” flow (file picker)
* Chunked transfer with SHA-256
* Save received files to downloads/app directory
* Record transfer in history (dedup by hash + name)

**Tests (must generate)**

* File transfer unit tests (chunking + hashing)
* Validate max size guard
* `scripts/hash-check.ts` to compute sha256 for manual verification

**How to test**

* Manual:

  * send 50–200MB file
  * verify saved file opens and hash matches using generated script

**Acceptance**

* Transfer file reliably, hash matches

---

## 6) Clipboard History (Desktop) — Data Model

History item:

* `id` (uuid)
* `mime`
* `contentHash` (sha256 of canonical bytes)
* `preview` (short text or “Image (WxH)” or “File: name.ext”)
* `sizeBytes`
* `firstSeen`
* `lastSeen`
* `source` = `local|remote`
* `originDeviceId`

Dedupe key: `mime + contentHash`

Storage:

* SQLite persistence (MVP): `${userData}/history.sqlite`

---

## 7) Chunking + Integrity (Required for images/files)

Constants:

* `CHUNK_SIZE_BYTES = 65536` (64KB)
* `MAX_TRANSFER_BYTES` default 50MB

Unencrypted logical structure (before encryption):

* `meta`, `chunk`, `done` as described (kept stable across phases)

Receiver rules:

* reassemble by index
* verify sha256 on done
* apply/save only if hash matches

---

## 8) Testing & Verification Docs (Required)

Codex must maintain:

* `docs/TESTING.md` with:

  * phase-by-phase commands
  * manual verification checklist
  * known limitations

Each package/app must have:

* `test` script in package.json
* minimal test runner:

  * TS: prefer `node:test` unless extra is required

---

## 9) Immediate Implementation Order (Do not deviate)

1. `packages/protocol` (add pairing messages + validators + tests)
2. `packages/server` (presence + pairing + signaling relay + tests)
3. `apps/desktop` skeleton (WS + clipboard watcher + history + tests)
4. WebRTC handshake + TURN
5. Text sync
6. Image chunking
7. File transfer

---

End of PLANS.md
