import { contextBridge } from "electron";

// Expose a minimal API for renderer diagnostics.
contextBridge.exposeInMainWorld("uc", {
  platform: process.platform,
});
