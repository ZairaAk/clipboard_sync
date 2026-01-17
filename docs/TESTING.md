# Testing

## Phase 0 - Protocol

### Automated
- `pnpm -C packages/protocol test`
- `pnpm -C packages/protocol build`

### Manual
- None

### Known limitations
- Protocol validation is schema-only; no runtime integration yet.

## Phase 1 - Server (presence + pairing + signaling)

### Automated
- `pnpm -C packages/server test`

### Manual
- Run server: `pnpm -C packages/server dev`
- In another terminal: `node packages/server/dist/scripts/ws-smoke.js`

### Known limitations
- Presence, pairing, and signaling are in-memory only (no persistence).

## Phase 2 - Desktop WebRTC state machine

### Automated
- `pnpm -C apps/desktop test`

### Manual
- Run server: `pnpm -C packages/server dev`
- Run desktop: `pnpm -C apps/desktop dev`
- Pair using a code and confirm the UI shows connected (when Phase 2 UI is wired).

### Known limitations
- WebRTC connectivity is validated with mocked signaling in tests.

## Phase 3 - Clipboard text sync + SQLite history

### Automated
- `pnpm -C apps/desktop test`

### Manual
- Run server: `pnpm -C packages/server dev`
- Run desktop: `pnpm -C apps/desktop dev`
- Use “Create Pair Code” on device A and “Join Pair” on device B
- Copy text A → paste on B
- Verify history list shows one entry, and duplicate copy updates lastSeen (no duplicates)

### Known limitations
- Full multi-device clipboard sync depends on WebRTC transport wiring.
