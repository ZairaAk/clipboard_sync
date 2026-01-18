import { ipcMain, BrowserWindow, app } from "electron";
import { WsClient } from "../ws/client";
import { DEFAULT_ICE_SERVERS } from "../config/defaultIce";
import { resolveIceServers } from "../config/ice";
import { DeviceStore } from "../deviceStore";
import type {
  DevicesUpdateMessage,
  PairCreatedMessage,
  PairPairedMessage,
  SignalMessage,
  ErrorMessage,
} from "@universal-clipboard/protocol";

let wsClient: WsClient | null = null;
let mainWindow: BrowserWindow | null = null;
let currentPairCode: string | null = null;
let pairedPeerId: string | null = null;

export type ConnectionState = {
  wsStatus: "disconnected" | "connecting" | "connected";
  pairCode: string | null;
  pairedPeerId: string | null;
};

function sendToRenderer(channel: string, data: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

function getConnectionState(): ConnectionState {
  return {
    wsStatus: wsClient?.getStatus() ?? "disconnected",
    pairCode: currentPairCode,
    pairedPeerId,
  };
}

export function initializeIpcHandlers(window: BrowserWindow, deviceStore: DeviceStore): void {
  mainWindow = window;

  // Get known devices
  ipcMain.handle("uc:getKnownDevices", () => deviceStore.getAll());

  // Forget a device
  ipcMain.handle("uc:forgetDevice", (_event, deviceId: string) => {
    deviceStore.remove(deviceId);
    return { success: true };
  });

  // Get current connection state
  ipcMain.handle("uc:getConnectionState", () => {
    return getConnectionState();
  });

  // Connect to server
  ipcMain.handle(
    "uc:connect",
    (_event, config: { serverUrl: string; deviceId: string }) => {
      if (wsClient) {
        wsClient.disconnect();
      }

      currentPairCode = null;
      pairedPeerId = null;

      wsClient = new WsClient(config, {
        onStatusChange: (status) => {
          sendToRenderer("uc:wsStatus", status);
          if (status === "disconnected") {
            currentPairCode = null;
          }
        },
        onDevicesUpdate: async (msg: DevicesUpdateMessage) => {
          await deviceStore.upsertMany(msg.devices);
          // Mark devices not in the payload as offline (since server is now stateless)
          const onlineIds = msg.devices.map(d => d.deviceId);
          await deviceStore.setOffline(onlineIds);

          sendToRenderer("uc:devicesUpdate", msg);
        },
        onPairCreated: (msg: PairCreatedMessage) => {
          currentPairCode = msg.code;
          sendToRenderer("uc:pairCreated", msg);
        },
        onPairPaired: (msg: PairPairedMessage) => {
          // Determine which device is the peer
          const selfId = wsClient?.getDeviceId();
          pairedPeerId = msg.a === selfId ? msg.b : msg.a;
          currentPairCode = null;
          sendToRenderer("uc:pairPaired", { ...msg, peerId: pairedPeerId });
        },
        onSignal: (msg: SignalMessage) => {
          sendToRenderer("uc:signal", msg);
        },
        onError: (msg: ErrorMessage) => {
          sendToRenderer("uc:error", msg);
        },
      });

      wsClient.connect();
      return { success: true };
    }
  );

  // Disconnect from server
  ipcMain.handle("uc:disconnect", () => {
    if (wsClient) {
      wsClient.disconnect();
      wsClient = null;
    }
    currentPairCode = null;
    pairedPeerId = null;
    return { success: true };
  });

  // Create a pairing code
  ipcMain.handle("uc:pairCreate", () => {
    if (!wsClient || wsClient.getStatus() !== "connected") {
      return { success: false, error: "Not connected to server" };
    }
    wsClient.pairCreate();
    return { success: true };
  });

  // Join with a pairing code
  ipcMain.handle("uc:pairJoin", (_event, code: string) => {
    if (!wsClient || wsClient.getStatus() !== "connected") {
      return { success: false, error: "Not connected to server" };
    }
    if (!/^\d{6}$/.test(code)) {
      return { success: false, error: "Code must be 6 digits" };
    }
    wsClient.pairJoin(code);
    return { success: true };
  });

  // Send a signaling message
  ipcMain.handle(
    "uc:sendSignal",
    (_event, to: string, payload: { kind: string; data: unknown }) => {
      if (!wsClient || wsClient.getStatus() !== "connected") {
        return { success: false, error: "Not connected to server" };
      }
      wsClient.sendSignal(to, payload as any);
      return { success: true };
    }
  );

  // Get ICE servers configuration
  ipcMain.handle("uc:getIceServers", () => {
    try {
      const servers = resolveIceServers({
        env: process.env,
        userDataDir: app.getPath("userData"),
      });
      return servers;
    } catch {
      // Fall back to default if resolution fails
      return DEFAULT_ICE_SERVERS;
    }
  });
}

export function getWsClient(): WsClient | null {
  return wsClient;
}

export function getPairedPeerId(): string | null {
  return pairedPeerId;
}
