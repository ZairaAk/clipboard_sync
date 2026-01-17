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
