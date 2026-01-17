const { test } = require("node:test");
const assert = require("node:assert/strict");

const { transitionState } = require("../dist/webrtc/stateMachine.js");

test("state machine transitions", () => {
  assert.equal(transitionState("DISCONNECTED", "start"), "CONNECTING");
  assert.equal(transitionState("CONNECTING", "datachannel_open"), "CONNECTED");
  assert.equal(transitionState("CONNECTING", "error"), "FAILED");
  assert.equal(transitionState("CONNECTED", "disconnect"), "DISCONNECTED");
  assert.equal(transitionState("FAILED", "disconnect"), "DISCONNECTED");
});
