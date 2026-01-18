import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import os from "node:os";
import { ensureIdentity } from "./identity";
import { HistoryStore } from "./clipboard/historyStore";
import { ClipboardSyncEngine } from "./clipboard/syncEngine";
import { resolveIceServers } from "./config/ice";
import { initializeIpcHandlers } from "./ipc/handlers";

// Create the main window with secure defaults (no remote, isolation on).
function createMainWindow() {
  const window = new BrowserWindow({
    width: 900,
    height: 600,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  const rendererPath = path.join(__dirname, "renderer", "index.html");
  window.loadFile(rendererPath);
  return window;
}

app.whenReady().then(() => {
  // Ensure the device identity is created before UI starts.
  const identity = ensureIdentity(app.getPath("userData"));
  const mainWindow = createMainWindow();

  // Initialize IPC handlers for WebSocket, pairing, signaling
  initializeIpcHandlers(mainWindow);

  const historyStore = new HistoryStore(app.getPath("userData"));

  const clipboardSync = new ClipboardSyncEngine({
    deviceId: identity.deviceId,
    history: historyStore,
    transport: {
      send: (event) => {
        // Forward outgoing clip events to the renderer transport.
        mainWindow.webContents.send("transport:send", event);
      },
    },
  });

  clipboardSync.start();

  ipcMain.handle("history:list", () => historyStore.list());
  ipcMain.handle("history:get", (_event, id: string) => historyStore.getById(id));
  ipcMain.handle("history:delete", async (_event, id: string) => {
    await historyStore.deleteById(id);
    notifyHistoryUpdated();
    return { success: true };
  });
  ipcMain.handle("identity:get", () => ({
    deviceId: identity.deviceId,
    deviceName: os.hostname(),
    platform: process.platform === "darwin" ? "mac" : process.platform === "win32" ? "windows" : "linux",
    publicKey: identity.publicKey,
  }));
  ipcMain.handle("config:ice", () =>
    resolveIceServers({ env: process.env, userDataDir: app.getPath("userData") }),
  );

  ipcMain.on("transport:receive", (_event, clipEvent) => {
    clipboardSync.handleRemoteEvent(clipEvent);
  });

  const notifyHistoryUpdated = () => {
    mainWindow.webContents.send("history:updated");
  };

  clipboardSync.onHistoryUpdated = notifyHistoryUpdated;

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });

  app.on("before-quit", () => {
    clipboardSync.stop();
    historyStore.close();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
