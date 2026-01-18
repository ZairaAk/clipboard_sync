# Codebase Walkthrough

This guide explains the purpose and key logic of the most important files in the repository.

## Directory Structure
*   `apps/desktop`: The actual Desktop Application.
*   `packages/server`: The Signaling Server.
*   `packages/protocol`: Shared types and schemas.

---

## 1. Shared Protocol (`packages/protocol`) 
Located in `src/index.ts`.
This is the **Source of Truth**. It uses **Zod** to define completely strict schema validation.
*   **Why?**: If we change the name of a field in a message, we change it here, and TypeScript immediately errors in both the Server and Desktop code, forcing us to fix it everywhere.
*   **Key Schemas**:
    *   `ClientToServerMessage`: Union of all things a client sends (`hello`, `pair_create`, `signal`).
    *   `ServerToClientMessage`: Union of all things a server replies (`pair_created`, `error`, `devices_update`).

## 2. Desktop Application (`apps/desktop`)

### `src/main.ts` (The Brain)
*   **Initialization**: verification of `identity.json` and `devices.json` happens immediately on startup.
*   **`createMainWindow`**: Spawns the browser window.
*   **`setupClipboardWatcher`**:
    *   Uses a polling mechanism (likely via `electron-clipboard-watcher` or custom interval) to check `clipboard.readText()`.
    *   If text differs from `lastText`, it emits a `clipboard-change` event.
    *   **Crucial Logic**: It checks `if (text !== lastReceivedText)` to avoid "Echo Loops" (where you receive text, write it, detect the write, and send it back).

### `src/preload.ts` (The Bridge)
*   Uses `contextBridge.exposeInMainWorld("uc", { ... })`.
*   This creates a global `window.uc` object in the frontend.
*   It functions as an API contract. The frontend cannot just "do anything"; it can only call the specific functions exposed here.

### `src/renderer/renderer.ts` (The Operator)
*   This file runs in the browser context.
*   **Main Logic Flow**:
    1.  **`init()`**: Connects to WebSocket.
    2.  **`connect()`**: Establishes link to Signaling Server.
    3.  **`onDevicesUpdate`**: Renders the device list HTML.
    4.  **`setupWebRTC()`**:
        *   When high-level signals (Offer/Answer) arrive via WebSocket, this logic feeds them into the `RTCPeerConnection` API.
        *   **`dataChannel.onmessage`**: When a peer sends data, this fires. It parses the JSON and calls `uc.transportReceive(data)`.

### `src/deviceStore.ts` (Persistence)
*   A wrapper class around `fs` (FileSystem).
*   **Methods**: `load()`, `save()`, `upsert()`, `ignore()`.
*   **Logic**: It keeps an in-memory `Map` for fast access and writes to disk (`devices.json`) on every change.
*   **Ignore Logic**: Instead of deleting, it marks `ignored: true` to handle server-side zombie devices.

### `src/clipboard/historyStore.ts`
*   Uses `sqlite3`.
*   **Why SQLite?**: History can grow large. JSON arrays are slow to parse if they have 1000 items. SQL provides fast `SELECT * FROM history ORDER BY timestamp DESC LIMIT 50`.

---

## 3. Signaling Server (`packages/server`)

### `src/server.ts`
*   **Implementation**: Pure Node.js `ws` library (no Socket.io).
*   **In-Memory State**:
    *   `clientBySocket`: Map<Socket, DeviceID>
    *   `presenceByDeviceId`: Map<DeviceID, Status>
*   **Handling**: A giant `switch` statement handles the `type` of each incoming message.
*   **Pairing Logic**:
    *   Generates 6-digit code.
    *   Stores it in a Map with a TTL (Time To Live).
    *   When a 2nd user connects with that code, it performs a lookup and introduces the two sockets.

## Key Workflows to Study
1.  **The Unpair Flow**:
    *   User Clicks Unpair -> Renderer sends DataChannel message "unpair" -> Peer receives it -> Both delete the mapping locally.
2.  **The Offline Queue**:
    *   `renderer.ts` has an array `offlineQueue`.
    *   If `send()` is called but WebRTC is `disconnected`, it `push()` events to the array.
    *   On `connected` event, it loops and flushes the queue.
