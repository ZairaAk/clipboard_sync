import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import {
  ClientToServerMessageSchema,
  DevicesUpdateMessageSchema,
  ErrorMessageSchema,
  PairCreatedMessageSchema,
  PairPairedMessageSchema,
  SignalMessageSchema,
} from "@universal-clipboard/protocol";
import {
  DEFAULT_PORT,
  DEFAULT_HOST,
  PAIR_CODE_TTL_MS,
  SIGNAL_RATE_LIMIT_COUNT,
  SIGNAL_RATE_LIMIT_WINDOW_MS,
} from "./config";
import { ERROR_CODES } from "./errors";
import type {
  ClientRecord,
  PairRecord,
  PresenceRecord,
  SignalRateState,
} from "./types";

const PAIR_CODE_REGEX = /^\d{6}$/;

// Central server runtime state, kept in-memory for Phase 1.
const presenceByDeviceId = new Map<string, PresenceRecord>();
const clientBySocket = new Map<WebSocket, ClientRecord>();
const pairByCode = new Map<string, PairRecord>();
const signalRateBySocket = new Map<WebSocket, SignalRateState>();

function sendJson(socket: WebSocket, payload: unknown) {
  socket.send(JSON.stringify(payload));
}

function sendError(socket: WebSocket, code: string, message: string) {
  const payload = ErrorMessageSchema.parse({ type: "error", code, message });
  sendJson(socket, payload);
}

function broadcastDevicesUpdate() {
  const devices = Array.from(presenceByDeviceId.values());
  const payload = DevicesUpdateMessageSchema.parse({
    type: "devices_update",
    devices,
  });

  for (const { socket } of clientBySocket.values()) {
    sendJson(socket, payload);
  }
}

function normalizePairCode(code: string) {
  return code.padStart(6, "0");
}

function generatePairCode() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const raw = Math.floor(Math.random() * 1_000_000).toString();
    const code = normalizePairCode(raw);
    if (!pairByCode.has(code)) {
      return code;
    }
  }

  // Fall back to a deterministic scan only if random collisions occur.
  for (let i = 0; i < 1_000_000; i += 1) {
    const code = normalizePairCode(String(i));
    if (!pairByCode.has(code)) {
      return code;
    }
  }

  return null;
}

function recordPresence(deviceId: string, update: Partial<PresenceRecord>) {
  const existing = presenceByDeviceId.get(deviceId);
  if (!existing) {
    return;
  }

  presenceByDeviceId.set(deviceId, { ...existing, ...update });
}

function isSignalRateLimited(socket: WebSocket, nowMs: number) {
  const state = signalRateBySocket.get(socket);
  if (!state) {
    signalRateBySocket.set(socket, { windowStartMs: nowMs, count: 1 });
    return false;
  }

  if (nowMs - state.windowStartMs > SIGNAL_RATE_LIMIT_WINDOW_MS) {
    state.windowStartMs = nowMs;
    state.count = 1;
    return false;
  }

  state.count += 1;
  return state.count > SIGNAL_RATE_LIMIT_COUNT;
}

function handleHello(socket: WebSocket, message: unknown) {
  const parsed = ClientToServerMessageSchema.safeParse(message);
  if (!parsed.success || parsed.data.type !== "hello") {
    sendError(socket, ERROR_CODES.INVALID_MESSAGE, "Invalid hello message");
    return;
  }

  const { deviceId, deviceName, platform, publicKey } = parsed.data;
  const presence: PresenceRecord = {
    deviceId,
    deviceName,
    platform,
    status: "online",
    lastSeen: Date.now(),
    publicKey,
  };

  presenceByDeviceId.set(deviceId, presence);
  clientBySocket.set(socket, { socket, deviceId });

  // Notify all clients when a device comes online.
  broadcastDevicesUpdate();
}

function handleHeartbeat(socket: WebSocket, message: unknown) {
  const parsed = ClientToServerMessageSchema.safeParse(message);
  if (!parsed.success || parsed.data.type !== "heartbeat") {
    sendError(socket, ERROR_CODES.INVALID_MESSAGE, "Invalid heartbeat message");
    return;
  }

  recordPresence(parsed.data.deviceId, { lastSeen: parsed.data.ts });
}

function handleListDevices(socket: WebSocket, message: unknown) {
  const parsed = ClientToServerMessageSchema.safeParse(message);
  if (!parsed.success || parsed.data.type !== "list_devices") {
    sendError(socket, ERROR_CODES.INVALID_MESSAGE, "Invalid list_devices message");
    return;
  }

  const devices = Array.from(presenceByDeviceId.values());
  sendJson(socket, DevicesUpdateMessageSchema.parse({ type: "devices_update", devices }));
}

function handlePairCreate(socket: WebSocket, message: unknown) {
  const parsed = ClientToServerMessageSchema.safeParse(message);
  if (!parsed.success || parsed.data.type !== "pair_create") {
    sendError(socket, ERROR_CODES.INVALID_MESSAGE, "Invalid pair_create message");
    return;
  }

  const code = generatePairCode();
  if (!code) {
    sendError(socket, ERROR_CODES.INVALID_MESSAGE, "Failed to create pair code");
    return;
  }

  const expiresAt = Date.now() + PAIR_CODE_TTL_MS;
  pairByCode.set(code, { creatorDeviceId: parsed.data.deviceId, expiresAt });

  const payload = PairCreatedMessageSchema.parse({
    type: "pair_created",
    deviceId: parsed.data.deviceId,
    code,
    expiresAt,
  });

  sendJson(socket, payload);
}

function handlePairJoin(socket: WebSocket, message: unknown) {
  const parsed = ClientToServerMessageSchema.safeParse(message);
  if (!parsed.success || parsed.data.type !== "pair_join") {
    sendError(socket, ERROR_CODES.INVALID_MESSAGE, "Invalid pair_join message");
    return;
  }

  if (!PAIR_CODE_REGEX.test(parsed.data.code)) {
    sendError(socket, ERROR_CODES.INVALID_MESSAGE, "Pair code must be 6 digits");
    return;
  }

  const record = pairByCode.get(parsed.data.code);
  if (!record) {
    sendError(socket, ERROR_CODES.PAIR_CODE_NOT_FOUND, "Pair code not found");
    return;
  }

  if (Date.now() > record.expiresAt) {
    pairByCode.delete(parsed.data.code);
    sendError(socket, ERROR_CODES.PAIR_CODE_EXPIRED, "Pair code expired");
    return;
  }

  pairByCode.delete(parsed.data.code);

  const creatorSocket = Array.from(clientBySocket.values()).find(
    (client) => client.deviceId === record.creatorDeviceId,
  )?.socket;

  if (!creatorSocket) {
    sendError(socket, ERROR_CODES.PEER_NOT_CONNECTED, "Pair creator not connected");
    return;
  }

  const payload = PairPairedMessageSchema.parse({
    type: "pair_paired",
    a: record.creatorDeviceId,
    b: parsed.data.deviceId,
  });

  sendJson(creatorSocket, payload);
  sendJson(socket, payload);
}

function handleSignal(socket: WebSocket, message: unknown) {
  const parsed = SignalMessageSchema.safeParse(message);
  if (!parsed.success) {
    sendError(socket, ERROR_CODES.INVALID_MESSAGE, "Invalid signal message");
    return;
  }

  if (isSignalRateLimited(socket, Date.now())) {
    sendError(socket, ERROR_CODES.RATE_LIMITED, "Signal rate limit exceeded");
    return;
  }

  const targetSocket = Array.from(clientBySocket.values()).find(
    (client) => client.deviceId === parsed.data.to,
  )?.socket;

  if (!targetSocket) {
    sendError(socket, ERROR_CODES.PEER_NOT_CONNECTED, "Target device not connected");
    return;
  }

  // Relay signaling payload without inspecting SDP/ICE contents.
  const payload = SignalMessageSchema.parse(parsed.data);
  sendJson(targetSocket, payload);
}

function handleClose(socket: WebSocket) {
  const client = clientBySocket.get(socket);
  if (!client) {
    return;
  }

  clientBySocket.delete(socket);
  signalRateBySocket.delete(socket);
  recordPresence(client.deviceId, { status: "offline", lastSeen: Date.now() });

  // Notify all clients when a device goes offline.
  broadcastDevicesUpdate();
}

function handleMessage(socket: WebSocket, raw: string) {
  let message: unknown;
  try {
    message = JSON.parse(raw);
  } catch {
    sendError(socket, ERROR_CODES.INVALID_MESSAGE, "Message must be JSON");
    return;
  }

  const parsed = ClientToServerMessageSchema.safeParse(message);
  if (!parsed.success) {
    sendError(socket, ERROR_CODES.INVALID_MESSAGE, "Unknown message type");
    return;
  }

  switch (parsed.data.type) {
    case "hello":
      handleHello(socket, message);
      break;
    case "heartbeat":
      handleHeartbeat(socket, message);
      break;
    case "list_devices":
      handleListDevices(socket, message);
      break;
    case "pair_create":
      handlePairCreate(socket, message);
      break;
    case "pair_join":
      handlePairJoin(socket, message);
      break;
    case "signal":
      handleSignal(socket, message);
      break;
    default:
      sendError(socket, ERROR_CODES.INVALID_MESSAGE, "Unsupported message type");
  }
}

export type RunningServer = {
  port: number;
  close: () => Promise<void>;
};

// Starts the WebSocket server with an optional port override.
export async function startServer(
  port = DEFAULT_PORT,
  host = DEFAULT_HOST,
): Promise<RunningServer> {
  const httpServer = createServer();
  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (socket) => {
    socket.on("message", (data) => handleMessage(socket, data.toString()));
    socket.on("close", () => handleClose(socket));
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(port, host, () => resolve());
  });

  const address = httpServer.address();
  const resolvedPort = typeof address === "string" ? port : address?.port ?? port;

  return {
    port: resolvedPort,
    close: () =>
      new Promise((resolve, reject) => {
        wss.close((err) => (err ? reject(err) : resolve()));
        httpServer.close();
      }),
  };
}
