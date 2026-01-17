import { contextBridge, ipcRenderer } from "electron";

// Expose a minimal API for renderer diagnostics + history access.
contextBridge.exposeInMainWorld("uc", {
  platform: process.platform,
  history: {
    list: () => ipcRenderer.invoke("history:list"),
    get: (id: string) => ipcRenderer.invoke("history:get", id),
    onUpdated: (callback: () => void) => {
      ipcRenderer.on("history:updated", callback);
      return () => ipcRenderer.removeListener("history:updated", callback);
    },
  },
  identity: {
    get: () => ipcRenderer.invoke("identity:get"),
  },
  config: {
    getIceServers: () => ipcRenderer.invoke("config:ice"),
    wsUrl: process.env.UC_WS_URL ?? "ws://localhost:8787",
  },
  transport: {
    onSend: (callback: (payload: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
        callback(payload);
      };
      ipcRenderer.on("transport:send", handler);
      return () => ipcRenderer.removeListener("transport:send", handler);
    },
    sendToMain: (payload: unknown) => ipcRenderer.send("transport:receive", payload),
  },
});
