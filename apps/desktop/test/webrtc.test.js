const { test } = require("node:test");
const assert = require("node:assert/strict");

const { WebRtcLink } = require("../dist/webrtc/webrtc.js");

class FakePeer {
  constructor() {
    this.onicecandidate = null;
    this.ondatachannel = null;
    this.localDescription = null;
    this.remoteDescription = null;
    this.createdChannel = null;
  }

  createDataChannel() {
    this.createdChannel = { onopen: null, onclose: null };
    return this.createdChannel;
  }

  async createOffer() {
    return { type: "offer", sdp: "offer-sdp" };
  }

  async createAnswer() {
    return { type: "answer", sdp: "answer-sdp" };
  }

  async setLocalDescription(desc) {
    this.localDescription = desc;
  }

  async setRemoteDescription(desc) {
    this.remoteDescription = desc;
  }

  async addIceCandidate() {}
}

test("initiator sends offer on start", async () => {
  const peer = new FakePeer();
  const sent = [];

  const link = new WebRtcLink({
    selfId: "a",
    peerId: "b",
    isInitiator: true,
    peer,
    sendSignal: (message) => sent.push(message),
  });

  await link.start();

  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.kind, "offer");
  assert.equal(peer.localDescription.type, "offer");
});

test("responder sends answer on offer", async () => {
  const peer = new FakePeer();
  const sent = [];

  const link = new WebRtcLink({
    selfId: "b",
    peerId: "a",
    isInitiator: false,
    peer,
    sendSignal: (message) => sent.push(message),
  });

  await link.handleSignal({
    type: "signal",
    to: "b",
    from: "a",
    payload: { kind: "offer", data: { type: "offer", sdp: "offer-sdp" } },
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.kind, "answer");
  assert.equal(peer.localDescription.type, "answer");
});
