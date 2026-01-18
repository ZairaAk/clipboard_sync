# System Architecture

## Overview
The Universal Clipboard system consists of three main components working in concert:
1.  **Desktop Client (Device A)**
2.  **Desktop Client (Device B)**
3.  **Signaling Server (Matchmaker)**

The system follows a **Peer-to-Peer (P2P)** architecture. The server is only used for the initial handshake; actual data transfer happens directly between devices.

---

## High-Level Data Flow

### Phase 1: Identity & Discovery
1.  **Startup**: App generates/loads a stable `deviceId` from `identity.json`.
2.  **Connection**: App connects to the **Signaling Server** via WebSocket.
3.  **Announcement**: App sends a `hello` message. Server records it in an in-memory map.

### Phase 2: Pairing (The Handshake)
1.  **User Action**: Device A requests a "Pairing Code" (`pair_create`).
2.  **Server**: Generates a 6-digit code (valid for 5 mins) and maps it to Device A's ID.
3.  **User Action**: User enters code on Device B (`pair_join`).
4.  **Server**: Matches code -> Device A. Sends `pair_paired` message to **BOTH** devices, exchanging their IDs.
5.  **Persistence**: Both devices save the other's ID to `devices.json`. They are now friends forever.

### Phase 3: WebRTC Connection (P2P)
Now that they know each other's IDs:
1.  **Offer**: Device A sends a WebRTC `offer` (SDP) to Server.
2.  **Relay**: Server sees "To: Device B" and forwards the packet.
3.  **Answer**: Device B receives offer, generates `answer` (SDP), sends to Server.
4.  **Relay**: Server forwards answer to Device A.
5.  **ICE Candidates**: Both devices exchange network info (IP:Port) via the Server until they find a direct path.
6.  **Connected**: The generic WebSocket path is typically abandoned for data transfer. A direct **Data Channel** is established.

### Phase 4: Clipboard Sync
1.  **Copy**: Device A User Ctrl+C.
2.  **Capture**: `main.ts` detects change via `electron-clipboard-watcher`.
3.  **Encrypt/Serialize**: Content is wrapped in a defined Protocol Buffer/JSON schema.
4.  **Send**: `renderer.ts` sends data via WebRTC Data Channel.
5.  **Receive**: Device B `renderer.ts` receives packet.
6.  **Write**: Device B sends IPC message to `main.ts` -> `clipboard.writeText(...)`.
7.  **Loop Prevention**: Logic prevents Device B from re-broadcasting what it just received.

---

## Internal Desktop Architecture (Electron)

Electron apps have two distinct processes. Separation of concerns is strict.

### 1. Main Process (`main.ts`)
*   **Role**: The "Backend" of the desktop app.
*   **Capabilities**: Full Node.js access (Filesystem, System Clipboard, OS resources).
*   **Key Responsibilities**:
    *   Window Management.
    *   **Clipboard Watching**: Polling the system clipboard for changes.
    *   **History Database**: Writing to SQLite.
    *   **Device Store**: Reading/Writing `devices.json`.
    *   **IPC Handling**: Responding to requests from the Frontend.

### 2. Renderer Process (`renderer.ts` + `index.html`)
*   **Role**: The "Frontend" UI.
*   **Capabilities**: Browser-like environment (HTML DOM). NO direct file access.
*   **Key Responsibilities**:
    *   **WebRTC Manager**: Browsers have the best WebRTC implementation, so the P2P logic lives here.
    *   **UI Rendering**: Device list, history view.
    *   **User Input**: Pairing codes, buttons.

### 3. Key Bridges
*   **Preload Script (`preload.ts`)**: The secure gateway. It exposes specific functions (via `contextBridge`) that allow the Renderer to ask the Main process to do things (e.g., "Please save this setting").
*   **IPC (Inter-Process Communication)**:
    *   `ipcMain`: Listens for events.
    *   `ipcRenderer`: Sends events.

## Diagram (Textual)

```mermaid
graph TD
    subgraph "Device A"
        A_UI[Renderer (UI)] <-->|IPC| A_Main[Main Process]
        A_Main -->|Watch| A_Clip[System Clipboard]
        A_UI -->|WebRTC Data Channel| B_UI
    end

    subgraph "Device B"
        B_UI[Renderer (UI)] <-->|IPC| B_Main[Main Process]
        B_Main -->|Write| B_Clip[System Clipboard]
    end

    subgraph "Cloud / Network"
        Server[Signaling Server]
    end

    A_UI -.->|WebSocket (Signal)| Server
    B_UI -.->|WebSocket (Signal)| Server
```
