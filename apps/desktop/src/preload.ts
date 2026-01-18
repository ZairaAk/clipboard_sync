import { contextBridge, ipcRenderer } from "electron";

// Expose a secure API for renderer to communicate with main process.
contextBridge.exposeInMainWorld("uc", {
  platform: process.platform,

  // Connection management
  connect: (config: { serverUrl: string; deviceId: string }) =>
    ipcRenderer.invoke("uc:connect", config),
  disconnect: () => ipcRenderer.invoke("uc:disconnect"),
  getConnectionState: () => ipcRenderer.invoke("uc:getConnectionState"),

  // Pairing
  pairCreate: () => ipcRenderer.invoke("uc:pairCreate"),
  pairJoin: (code: string) => ipcRenderer.invoke("uc:pairJoin", code),

  // Signaling
  sendSignal: (to: string, payload: { kind: string; data: unknown }) =>
    ipcRenderer.invoke("uc:sendSignal", to, payload),

  // ICE servers for WebRTC
  getIceServers: () => ipcRenderer.invoke("uc:getIceServers"),

  // Event listeners
  onWsStatus: (callback: (status: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: string) =>
      callback(status);
    ipcRenderer.on("uc:wsStatus", handler);
    return () => ipcRenderer.removeListener("uc:wsStatus", handler);
  },
  onDevicesUpdate: (callback: (msg: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, msg: unknown) =>
      callback(msg);
    ipcRenderer.on("uc:devicesUpdate", handler);
    return () => ipcRenderer.removeListener("uc:devicesUpdate", handler);
  },
  onPairCreated: (callback: (msg: { code: string; expiresAt: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, msg: { code: string; expiresAt: number }) =>
      callback(msg);
    ipcRenderer.on("uc:pairCreated", handler);
    return () => ipcRenderer.removeListener("uc:pairCreated", handler);
  },
  onPairPaired: (callback: (msg: { a: string; b: string; peerId: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, msg: { a: string; b: string; peerId: string }) =>
      callback(msg);
    ipcRenderer.on("uc:pairPaired", handler);
    return () => ipcRenderer.removeListener("uc:pairPaired", handler);
  },
  onSignal: (callback: (msg: { from: string; payload: { kind: string; data: unknown } }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, msg: { from: string; payload: { kind: string; data: unknown } }) =>
      callback(msg);
    ipcRenderer.on("uc:signal", handler);
    return () => ipcRenderer.removeListener("uc:signal", handler);
  },
  onError: (callback: (msg: { code: string; message: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, msg: { code: string; message: string }) =>
      callback(msg);
    ipcRenderer.on("uc:error", handler);
    return () => ipcRenderer.removeListener("uc:error", handler);
  },
});
