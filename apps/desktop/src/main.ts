import { app, BrowserWindow } from "electron";
import path from "node:path";
import { ensureIdentity } from "./identity";
import { initializeIpcHandlers } from "./ipc/handlers";

let mainWindow: BrowserWindow | null = null;

// Create the main window with secure defaults (no remote, isolation on).
function createMainWindow(): BrowserWindow {
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
  ensureIdentity(app.getPath("userData"));

  mainWindow = createMainWindow();

  // Initialize IPC handlers for WebSocket and pairing
  initializeIpcHandlers(mainWindow);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
      initializeIpcHandlers(mainWindow);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
