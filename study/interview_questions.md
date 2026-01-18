# Interview Questions & Concepts

A project like this covers multiple complex domains: Distributed Systems, Low-level Networking, and System Integration. Here are likely questions and answers.

## Section 1: Architecture & System Design

### Q: Why use WebRTC instead of just sending data through the server?
**A**
1.  **Privacy**: End-to-End Encryption (E2EE) is possible (and default in WebRTC). The server never sees the clipboard content, only offers/answers.
2.  **Latency**: Direct P2P on a LAN is < 5ms. Server relay adds round-trip time (RTT) to the internet.
3.  **Cost**: Bandwidth is expensive. If I copy a 10MB image, sending it P2P costs the developer $0. Relay costs money.

### Q: What acts as the STUN/TURN server in this project?
**A**: Currently, we are relying on public STUN servers (like Google's) or local LAN discovery (mDNS).
*   **STUN**: Tells you your public IP.
*   **TURN**: Relays traffic if P2P fails (Symmetric NAT).
*   *Note*: This project currently does not implement a TURN server, so it might fail on strictly blocked enterprise networks.

### Q: How do you handle "Echo Loops" in clipboard synchronization?
**A**:
*   **The Problem**: Device A copies "Foo" -> Sends to B -> B writes "Foo" -> B detects separate "change" -> Sends "Foo" back to A -> Infinite Loop.
*   **The Solution**: We store the `lastReceivedText` in a variable. When the clipboard watcher fires, we compare the new content with `lastReceivedText`. If they match, we assume *we* wrote it via the sync mechanism, so we suppress the broadcast.

---

## Section 2: Networking (WebRTC)

### Q: What is the role of SDP (Session Description Protocol)?
**A**: It describes the multimedia capabilities and network info. It looks like a text blob.
*   **Offer**: "I can support video/audio/data, here are my codecs."
*   **Answer**: "I accept data, I support these codecs."
We exchange these via the specific Signaling Server (WebSocket).

### Q: What happens if both devices go offline and come back with different IPs?
**A**: WebRTC has an "ICE Restart" mechanism, but typically the connection drops. Our application handles this by:
1.  Detecting the `disconnected` state.
2.  Queuing outgoing messages (Offline Queue).
3.  Re-initiating the Signaling / Negotiation flow to establish a fresh connection.

---

## Section 3: Electron & Node.js

### Q: Why use `ipcMain` and `ipcRenderer`? Why not just access `fs` from the UI?
**A**: Security.
*   If you enable `nodeIntegration: true` in the renderer, any XSS (Cross-Site Scripting) attack could delete your hard drive (`fs.unlink`).
*   By using **Context Isolation** and **Preload Scripts**, we whitelist only specific actions (`getHistory`, `forgetDevice`). Code injection in the UI cannot access the underlying OS directly.

### Q: How does the server scale if we have 1 million users?
**A**:
*   The current in-memory implementation (`Map<string, Client>`) would crash RAM.
*   **Scaling Solution**: Move the session state to **Redis**.
*   Spin up 50 instances of the Node.js server. Use Redis Pub/Sub to pass signals between instances (e.g., User A is on Server 1, User B is on Server 20).

---

## Section 4: General Coding

### Q: Why use Zod for validation?
**A**: TypeScript types disappear at runtime. If a malicious user sends `{ "type": "hack" }`, TypeScript won't catch it. Zod runs **at runtime** and throws an error if the JSON structure doesn't match the schema, preventing undefined behavior or crashes.

### Q: What is the purpose of a Monorepo (Turborepo)?
**A**: It allows atomic commits. I can change the Protocol, the Server handling that protocol, and the Client verification ALL in a single Git commit. This prevents "Version Drift" where the server expects API v2 but the client is sending v1.
