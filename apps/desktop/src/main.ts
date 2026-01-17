import { app, BrowserWindow } from "electron";
import path from "node:path";
import { ensureIdentity } from "./identity";

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
}

app.whenReady().then(() => {
  // Ensure the device identity is created before UI starts.
  ensureIdentity(app.getPath("userData"));
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
