const { test } = require("node:test");
const assert = require("node:assert/strict");

const { LoopPrevention } = require("../dist/clipboard/loopPrevention.js");

test("suppress flag is set after remote apply", () => {
  const loop = new LoopPrevention();
  const now = Date.now();

  loop.markRemoteApplied(500, now);
  assert.equal(loop.shouldSuppressLocal(now + 100), true);
  assert.equal(loop.shouldSuppressLocal(now + 600), false);
});

test("eventId dedupe drops repeats", () => {
  const loop = new LoopPrevention();
  loop.remember("event-1");
  assert.equal(loop.hasSeen("event-1"), true);
  assert.equal(loop.hasSeen("event-2"), false);
});
