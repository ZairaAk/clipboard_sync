import type { WebSocket } from "ws";
import type { DeviceInfo } from "@universal-clipboard/protocol";

// Tracks a connected client and its device metadata for presence/state updates.
export type ClientRecord = {
  socket: WebSocket;
  deviceId: string;
};

// Stored presence record with current status and last-seen metadata.
export type PresenceRecord = DeviceInfo;

// Tracks pairing code ownership and expiration.
export type PairRecord = {
  creatorDeviceId: string;
  expiresAt: number;
};

// Fixed 10s window rate limit for signaling per socket.
export type SignalRateState = {
  windowStartMs: number;
  count: number;
};
