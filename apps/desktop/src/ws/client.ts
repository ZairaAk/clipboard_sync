import WebSocket from "ws";
import os from "node:os";
import crypto from "node:crypto";
import type {
  HelloMessage,
  PairCreateMessage,
  PairJoinMessage,
  SignalMessage,
  ServerToClientMessage,
  DevicesUpdateMessage,
  PairCreatedMessage,
  PairPairedMessage,
  ErrorMessage,
  SignalPayload,
} from "@universal-clipboard/protocol";

export type WsClientStatus = "disconnected" | "connecting" | "connected";

export type WsClientEvents = {
  onStatusChange?: (status: WsClientStatus) => void;
  onDevicesUpdate?: (msg: DevicesUpdateMessage) => void;
  onPairCreated?: (msg: PairCreatedMessage) => void;
  onPairPaired?: (msg: PairPairedMessage) => void;
  onSignal?: (msg: SignalMessage) => void;
  onError?: (msg: ErrorMessage) => void;
};

export type WsClientConfig = {
  serverUrl: string;
  deviceId: string;
  deviceName?: string;
  publicKey?: string;
};

function getPlatform(): "windows" | "mac" | "linux" {
  const p = os.platform();
  if (p === "win32") return "windows";
  if (p === "darwin") return "mac";
  return "linux";
}

function generateDummyPublicKey(): string {
  // Generate a 32-byte random key and encode as base64 (44 chars).
  // In MVP, E2EE is not implemented; DTLS handles transport security.
  return crypto.randomBytes(32).toString("base64");
}

export class WsClient {
  private ws: WebSocket | null = null;
  private status: WsClientStatus = "disconnected";
  private config: WsClientConfig;
  private events: WsClientEvents;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private publicKey: string;

  constructor(config: WsClientConfig, events: WsClientEvents = {}) {
    this.config = config;
    this.events = events;
    this.publicKey = config.publicKey ?? generateDummyPublicKey();
  }

  connect(): void {
    if (this.status !== "disconnected") return;
    this.setStatus("connecting");

    this.ws = new WebSocket(this.config.serverUrl);

    this.ws.on("open", () => {
      this.setStatus("connected");
      this.sendHello();
      this.startHeartbeat();
    });

    this.ws.on("message", (data) => {
      this.handleMessage(data.toString());
    });

    this.ws.on("close", () => {
      this.cleanup();
      this.setStatus("disconnected");
      this.scheduleReconnect();
    });

    this.ws.on("error", (err) => {
      console.error("[WsClient] WebSocket error:", err.message);
      // Error event is followed by close event, so reconnect handled there.
    });
  }

  disconnect(): void {
    this.stopReconnect();
    this.cleanup();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setStatus("disconnected");
  }

  getStatus(): WsClientStatus {
    return this.status;
  }

  getDeviceId(): string {
    return this.config.deviceId;
  }

  pairCreate(): void {
    const msg: PairCreateMessage = {
      type: "pair_create",
      deviceId: this.config.deviceId,
    };
    this.send(msg);
  }

  pairJoin(code: string): void {
    const msg: PairJoinMessage = {
      type: "pair_join",
      deviceId: this.config.deviceId,
      code,
    };
    this.send(msg);
  }

  sendSignal(to: string, payload: SignalPayload): void {
    const msg: SignalMessage = {
      type: "signal",
      to,
      from: this.config.deviceId,
      payload,
    };
    this.send(msg);
  }

  private send(msg: object): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private sendHello(): void {
    const msg: HelloMessage = {
      type: "hello",
      deviceId: this.config.deviceId,
      deviceName: this.config.deviceName ?? os.hostname(),
      platform: getPlatform(),
      publicKey: this.publicKey,
    };
    this.send(msg);
  }

  private handleMessage(raw: string): void {
    let msg: ServerToClientMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      console.error("[WsClient] Failed to parse message:", raw);
      return;
    }

    switch (msg.type) {
      case "devices_update":
        this.events.onDevicesUpdate?.(msg);
        break;
      case "pair_created":
        this.events.onPairCreated?.(msg);
        break;
      case "pair_paired":
        this.events.onPairPaired?.(msg);
        break;
      case "signal":
        this.events.onSignal?.(msg);
        break;
      case "error":
        this.events.onError?.(msg);
        break;
      default:
        console.warn("[WsClient] Unknown message type:", (msg as any).type);
    }
  }

  private setStatus(status: WsClientStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.events.onStatusChange?.(status);
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send({
        type: "heartbeat",
        deviceId: this.config.deviceId,
        ts: Date.now(),
      });
    }, 30_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private cleanup(): void {
    this.stopHeartbeat();
  }

  private scheduleReconnect(): void {
    this.stopReconnect();
    this.reconnectTimer = setTimeout(() => {
      console.log("[WsClient] Attempting reconnect...");
      this.connect();
    }, 3000);
  }

  private stopReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
