
# Universal Clipboard Sync

Universal Clipboard Sync is a privacy-focused, cross-platform application that allows you to seamlessly sync your clipboard across multiple devices. It uses a hybrid architecture with a central signaling server and direct peer-to-peer (P2P) communication for secure and efficient clipboard synchronization.

## Features

*   **Cross-Platform:** Works on Windows, macOS, and Linux.
*   **Privacy-Focused:** End-to-end encryption ensures that your clipboard data is only readable by your paired devices. The central server never has access to your data.
*   **Device Syncing & Real-Time Sync:** Seamlessly synchronize clipboard content across all your paired devices in near real-time.
*   **Device Pairing:** Easily pair your devices using a secure, short-lived pairing code.
*   **Searchable Clipboard History:** The desktop application provides a local, searchable history of your copied items.

## How It Works

The application uses a hybrid communication model that combines a WebSocket server for signaling with direct WebRTC connections for data transfer.


1.  **Device Registration:** Each desktop client connects to the WebSocket server and is assigned a unique ID.
2.  **Device Pairing:** Users pair devices using a one-time code.
3.  **WebRTC Signaling:** The WebSocket server acts as a signaling broker to help the paired devices establish a direct WebRTC connection.
4.  **P2P Clipboard Sync:** Once the connection is established, clipboard data is end-to-end encrypted and sent directly between the devices over a WebRTC data channel.

## Tech Stack

*   **[TypeScript]:** For type safety and improved code quality.
*   **[pnpm]:** For efficient monorepo and package management.
*   **[Electron]:** For building the cross-platform desktop application.
*   **[Node.js]:** For the backend signaling server.
*   **[WebSocket (`ws`)]:** For real-time signaling between clients and the server.
*   **[WebRTC]:** For secure, peer-to-peer data transfer.
*   **[SQLite]:** For local data storage in the desktop app.

## Commands & Cross-Platform Setup

### Prerequisites
*   Node.js: v20+
*   pnpm: v9+ (npm install -g pnpm)

### 1. Initial Setup (All OS)
Run this from the root directory to install dependencies:
```bash
pnpm install
```

### 2. Build Protocol (Required)
Before running the desktop app, you must build the shared protocol package:
```bash
pnpm -C packages/protocol build
```

### 3. Run Signaling Server
Examples assume you are in the root directory.
```bash
pnpm -C packages/server dev
```
Server runs on port 8080.
**Note:** For different networks, you may need a tunnel (e.g., ngrok).

### 4. Run Desktop App
```bash
pnpm -C apps/desktop dev
```

### OS-Specific Visuals & Troubleshooting

#### Windows
*   **Shell:** PowerShell is recommended.
*   **Troubleshooting:** If you see "Gpu Cache Creation failed", it is a minor Electron warning and can be ignored.

#### macOS
*   **Requirements:** Xcode Command Line Tools (`xcode-select --install`) and Python (usually pre-installed).
*   **Troubleshooting:** If the app fails to start, ensure `packages/protocol` is freshly built (`pnpm -C packages/protocol build`).

#### Linux
*   **Requirements:** You may need build tools for native modules (like `sqlite3`).
    *   **Ubuntu/Debian:** `sudo apt install build-essential python3`
    *   **Fedora:** `sudo dnf groupinstall "Development Tools"`
*   **Troubleshooting:** If WebRTC fails, check firewall settings or ICE server config.

## Project Structure

This project is a `pnpm` monorepo.

*   `apps/desktop/`: The Electron-based desktop application.
*   `packages/server/`: The Node.js WebSocket server for signaling.
*   `packages/protocol/`: A shared package defining the communication protocol with Zod schemas.

