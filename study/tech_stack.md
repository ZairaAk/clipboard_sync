# Technology Stack & Design Decisions

This document details the technology choices for the Universal Clipboard project, the rationale behind them, and the alternatives that were considered but rejected.

## 1. Core Framework: Electron
**What it is**: A framework for building cross-platform desktop apps with web technologies (HTML/CSS/JS).

**Why we chose it**:
*   **System APIs**: Crucial for a clipboard manager. Electron has mature, robust APIs for reading/writing the system clipboard (`clipboard` module) and registering global shortcuts.
*   **Rapid Development**: Allows sharing TypeScript logic between the backend (Node.js) and frontend (React/Vanilla JS).
*   **Ecosystem**: Huge community and plugins compared to newer alternatives.

**Alternatives Considered**:
*   **Tauri (Rust)**:
    *   *Pros*: Much smaller binary size, lower memory usage.
    *   *Cons*: Requires Rust knowledge for backend logic. The clipboard access APIs are less mature than Electron's.
    *   *Verdict*: Rejected to maintain a full TypeScript stack and ensure rapid iteration speed.
*   **Flutter**:
    *   *Pros*: High performance UI.
    *   *Cons*: Platform integration for "invisible" background services (like clipboard listening) is more complex.
    *   *Verdict*: Rejected as it introduces a new language (Dart).

## 2. Networking: WebRTC (Peer-to-Peer)
**What it is**: A standard that enables real-time communication directly between browsers/devices.

**Why we chose it**:
*   **Privacy**: Clipboard data goes directly from Device A to Device B. It **never** touches our server database.
*   **Latency**: Fastest possible transfer (local network speed if devices are on same WiFi).
*   **Cost**: Reduced server costs as connection data bypasses the server.

**Alternatives Considered**:
*   **WebSocket Relay (Centralized)**:
    *   *How it works*: Device A -> Server -> Device B.
    *   *Pros*: Simpler to implement (no NAT traversal/ICE).
    *   *Cons*: High latency. Privacy risk (server sees data). High bandwidth costs for server.
    *   *Verdict*: Rejected. Privacy and speed were higher priorities.
*   **Polling (HTTP)**:
    *   *How it works*: Device B asks Server "Any new data?" every second.
    *   *Cons*: Terrible efficiency. Delayed sync.
    *   *Verdict*: Rejected immediately.

## 3. Build System: Turborepo (Monorepo)
**What it is**: A high-performance build system for JavaScript/TypeScript monorepos.

**Why we chose it**:
*   **Shared Code**: We have a `packages/protocol` folder. Both the `server` and `apps/desktop` import the EXACT same Zod schemas. This guarantees that if the server expects a message, the client is sending exactly that format.
*   **Caching**: `pnpm build` only rebuilds what changed.

**Alternatives Considered**:
*   **Separate Repositories**:
    *   *Cons*: Keeping `server` and `client` types in sync becomes a nightmare. Version mismatch bugs.
    *   *Verdict*: Rejected.

## 4. Signaling Server: Node.js + WebSocket (ws)
**What it is**: A lightweight server that helps devices find each other to establish the WebRTC link.

**Why we chose it**:
*   **Simplicity**: It effectively just passes messages. Node.js is perfect for high-concurrency, low-CPU tasks.
*   **TypeScript**: Shares the `protocol` package with the desktop app.

## 5. Persistence: JSON Files (Node.js `fs`)
**What it is**: Storing data (`identity.json`, `devices.json`) as simple text files.

**Why we chose it**:
*   **Portability**: Easy to back up, inspect, and debug.
*   **Zero Dependencies**: No need to install PostgreSQL or SQLite drivers for simple key-value needs.

**Alternatives Considered**:
*   **SQLite**:
    *   *Pros*: Better for 1000s of records.
    *   *Cons*: Overkill for storing a list of ~5 devices and 1 identity.
    *   *Verdict*: Rejected for simplicity, though the user has a `historyStore` that uses SQLite for clipboard history (good hybrid approach).

## Summary Table

| Component | Choice | Why? |
| :--- | :--- | :--- |
| **App Shell** | Electron | Best OS Integration |
| **Transport** | WebRTC | Privacy & Speed |
| **Server** | WebSocket (ws) | Low Latency Handshakes |
| **Repo** | Turborepo | Type Safety across Frontend/Backend |
| **Validation** | Zod | Runtime type checking for network messages |
