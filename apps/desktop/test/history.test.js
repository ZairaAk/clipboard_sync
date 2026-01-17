const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { HistoryStore } = require("../dist/clipboard/historyStore.js");

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "uc-history-"));
}

test("history dedupes by mime + contentHash", async () => {
  const dir = createTempDir();
  const store = new HistoryStore(dir);

  const first = await store.upsertText({
    text: "Hello world",
    source: "local",
    originDeviceId: "device-a",
  });

  const second = await store.upsertText({
    text: "Hello world",
    source: "remote",
    originDeviceId: "device-b",
  });

  const list = await store.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, first.id);
  assert.equal(list[0].lastSeen, second.lastSeen);
  assert.equal(list[0].originDeviceId, "device-b");

  await store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("history enforces max items", async () => {
  const dir = createTempDir();
  const store = new HistoryStore(dir);

  for (let i = 0; i < 210; i += 1) {
    await store.upsertText({
      text: `item-${i}`,
      source: "local",
      originDeviceId: "device-a",
    });
  }

  const list = await store.list();
  assert.equal(list.length, 200);

  await store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
