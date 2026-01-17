const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const WebSocket = require("ws");

const { startServer } = require("../dist/src/server.js");

const DEVICE_ID_A = "550e8400-e29b-41d4-a716-446655440000";
const DEVICE_ID_B = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const PUBLIC_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

let server;
let baseUrl;

// Connect a client to the test server and resolve on open.
function connectClient() {
  return new Promise((resolve) => {
    const socket = new WebSocket(baseUrl);
    socket.on("open", () => resolve(socket));
  });
}

// Wait for a message matching the predicate and return the parsed JSON.
function waitForMessage(socket, predicate) {
  return new Promise((resolve) => {
    socket.on("message", (data) => {
      const parsed = JSON.parse(data.toString());
      if (predicate(parsed)) {
        resolve(parsed);
      }
    });
  });
}

before(async () => {
  server = await startServer(0);
  baseUrl = `ws://localhost:${server.port}`;
});

after(async () => {
  await server.close();
});

test("presence, pairing, and signaling flow", async () => {
  const clientA = await connectClient();
  const clientB = await connectClient();

  // Register both devices so they appear in presence updates.
  clientA.send(
    JSON.stringify({
      type: "hello",
      deviceId: DEVICE_ID_A,
      deviceName: "A",
      platform: "mac",
      publicKey: PUBLIC_KEY,
    }),
  );

  clientB.send(
    JSON.stringify({
      type: "hello",
      deviceId: DEVICE_ID_B,
      deviceName: "B",
      platform: "windows",
      publicKey: PUBLIC_KEY,
    }),
  );

  // Wait for presence broadcast that includes both devices.
  await waitForMessage(
    clientA,
    (message) =>
      message.type === "devices_update" && message.devices.length === 2,
  );

  // Ensure list_devices returns both devices.
  clientA.send(JSON.stringify({ type: "list_devices" }));
  const devicesUpdate = await waitForMessage(
    clientA,
    (message) => message.type === "devices_update",
  );

  assert.equal(devicesUpdate.devices.length, 2);

  // Create a pairing code from client A and have client B join it.
  clientA.send(JSON.stringify({ type: "pair_create", deviceId: DEVICE_ID_A }));
  const pairCreated = await waitForMessage(
    clientA,
    (message) => message.type === "pair_created",
  );

  assert.match(pairCreated.code, /^\d{6}$/);

  clientB.send(
    JSON.stringify({
      type: "pair_join",
      deviceId: DEVICE_ID_B,
      code: pairCreated.code,
    }),
  );

  // Both clients should receive the pair_paired event.
  const pairedA = await waitForMessage(
    clientA,
    (message) => message.type === "pair_paired",
  );
  const pairedB = await waitForMessage(
    clientB,
    (message) => message.type === "pair_paired",
  );

  assert.equal(pairedA.a, DEVICE_ID_A);
  assert.equal(pairedB.b, DEVICE_ID_B);

  // Relay a signaling offer from A to B.
  clientA.send(
    JSON.stringify({
      type: "signal",
      to: DEVICE_ID_B,
      from: DEVICE_ID_A,
      payload: { kind: "offer", data: { sdp: "v=0" } },
    }),
  );

  const signalOnB = await waitForMessage(
    clientB,
    (message) => message.type === "signal",
  );

  assert.equal(signalOnB.from, DEVICE_ID_A);
  assert.equal(signalOnB.to, DEVICE_ID_B);

  clientA.close();
  clientB.close();
});
