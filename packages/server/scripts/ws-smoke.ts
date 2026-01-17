import WebSocket from "ws";

// Manual smoke script: connects two clients and prints server events.
const SERVER_URL = process.env.WS_URL ?? "ws://localhost:8787";

type DeviceHello = {
  deviceId: string;
  deviceName: string;
  platform: "mac" | "windows" | "linux";
  publicKey: string;
};

const deviceA: DeviceHello = {
  deviceId: "550e8400-e29b-41d4-a716-446655440000",
  deviceName: "Smoke A",
  platform: "mac",
  publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
};

const deviceB: DeviceHello = {
  deviceId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  deviceName: "Smoke B",
  platform: "windows",
  publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
};

function connectClient(label: string, hello: DeviceHello) {
  const socket = new WebSocket(SERVER_URL);

  socket.on("open", () => {
    socket.send(JSON.stringify({ type: "hello", ...hello }));
  });

  socket.on("message", (data) => {
    console.log(`[${label}]`, data.toString());
  });

  return socket;
}

const clientA = connectClient("A", deviceA);
const clientB = connectClient("B", deviceB);

setTimeout(() => {
  clientA.send(JSON.stringify({ type: "list_devices" }));
}, 500);

setTimeout(() => {
  clientA.send(JSON.stringify({ type: "pair_create", deviceId: deviceA.deviceId }));
}, 1000);

clientA.on("message", (data) => {
  const parsed = JSON.parse(data.toString());
  if (parsed.type === "pair_created") {
    clientB.send(
      JSON.stringify({
        type: "pair_join",
        deviceId: deviceB.deviceId,
        code: parsed.code,
      }),
    );
  }
});
