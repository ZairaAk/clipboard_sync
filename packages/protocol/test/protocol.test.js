const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  ClipEventMessageSchema,
  HelloMessageSchema,
  PairCreateMessageSchema,
  PairCreatedMessageSchema,
  PairJoinMessageSchema,
  PairPairedMessageSchema,
  SignalMessageSchema,
} = require("../dist/index.js");

const DEVICE_ID_A = "550e8400-e29b-41d4-a716-446655440000";
const DEVICE_ID_B = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const PUBLIC_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

const nowMs = 1730000000000;

test("hello message validates", () => {
  const message = {
    type: "hello",
    deviceId: DEVICE_ID_A,
    deviceName: "Laptop A",
    platform: "mac",
    publicKey: PUBLIC_KEY,
  };

  assert.deepEqual(HelloMessageSchema.parse(message), message);
});

test("signal message validates", () => {
  const message = {
    type: "signal",
    to: DEVICE_ID_B,
    from: DEVICE_ID_A,
    payload: {
      kind: "offer",
      data: { sdp: "v=0" },
    },
  };

  assert.deepEqual(SignalMessageSchema.parse(message), message);
});

test("pairing messages validate", () => {
  const createMessage = {
    type: "pair_create",
    deviceId: DEVICE_ID_A,
  };
  const joinMessage = {
    type: "pair_join",
    deviceId: DEVICE_ID_B,
    code: "123456",
  };
  const createdMessage = {
    type: "pair_created",
    deviceId: DEVICE_ID_A,
    code: "123456",
    expiresAt: nowMs,
  };
  const pairedMessage = {
    type: "pair_paired",
    a: DEVICE_ID_A,
    b: DEVICE_ID_B,
  };

  assert.deepEqual(PairCreateMessageSchema.parse(createMessage), createMessage);
  assert.deepEqual(PairJoinMessageSchema.parse(joinMessage), joinMessage);
  assert.deepEqual(PairCreatedMessageSchema.parse(createdMessage), createdMessage);
  assert.deepEqual(PairPairedMessageSchema.parse(pairedMessage), pairedMessage);
});

test("clip_event validates", () => {
  const message = {
    type: "clip_event",
    eventId: "9b2b1a41-2f54-4c3c-8fd6-6a7f2a7d1cb4",
    originDeviceId: DEVICE_ID_A,
    timestampMs: nowMs,
    mime: "text/plain",
    nonce: "AA==",
    ciphertext: "AQIDBA==",
  };

  assert.deepEqual(ClipEventMessageSchema.parse(message), message);
});
