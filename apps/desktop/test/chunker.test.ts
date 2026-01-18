import { describe, it } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import { chunkBuffer, createChunkedEvent, CHUNK_SIZE, MAX_IMAGE_SIZE } from "../src/clipboard/chunker";

describe("chunker", () => {
  describe("chunkBuffer", () => {
    it("should split buffer into chunks of CHUNK_SIZE", () => {
      // Create a buffer of exactly 3 chunks
      const buffer = Buffer.alloc(CHUNK_SIZE * 3, 0x42);
      const chunks = chunkBuffer(buffer);

      assert.strictEqual(chunks.length, 3);
      assert.strictEqual(chunks[0].length, CHUNK_SIZE);
      assert.strictEqual(chunks[1].length, CHUNK_SIZE);
      assert.strictEqual(chunks[2].length, CHUNK_SIZE);
    });

    it("should handle partial last chunk", () => {
      // Create a buffer that's 2.5 chunks
      const buffer = Buffer.alloc(Math.floor(CHUNK_SIZE * 2.5), 0x42);
      const chunks = chunkBuffer(buffer);

      assert.strictEqual(chunks.length, 3);
      assert.strictEqual(chunks[0].length, CHUNK_SIZE);
      assert.strictEqual(chunks[1].length, CHUNK_SIZE);
      assert.strictEqual(chunks[2].length, Math.floor(CHUNK_SIZE * 0.5));
    });

    it("should handle small buffer (single chunk)", () => {
      const buffer = Buffer.from("small data");
      const chunks = chunkBuffer(buffer);

      assert.strictEqual(chunks.length, 1);
      assert.strictEqual(chunks[0].length, buffer.length);
    });

    it("should handle empty buffer", () => {
      const buffer = Buffer.alloc(0);
      const chunks = chunkBuffer(buffer);

      assert.strictEqual(chunks.length, 0);
    });
  });

  describe("createChunkedEvent", () => {
    const mockDeviceId = "12345678-1234-4123-8123-123456789abc";

    it("should create start message with correct metadata", () => {
      const buffer = Buffer.alloc(CHUNK_SIZE * 2, 0x42);
      const result = createChunkedEvent({
        buffer,
        mime: "image/png",
        originDeviceId: mockDeviceId,
      });

      assert.strictEqual(result.startMessage.type, "clip_start");
      assert.strictEqual(result.startMessage.mime, "image/png");
      assert.strictEqual(result.startMessage.totalBytes, buffer.length);
      assert.strictEqual(result.startMessage.totalChunks, 2);
      assert.strictEqual(result.startMessage.originDeviceId, mockDeviceId);
      assert.ok(result.startMessage.eventId);
      assert.ok(result.startMessage.timestampMs > 0);
    });

    it("should create chunk messages with correct data", () => {
      const buffer = Buffer.alloc(CHUNK_SIZE + 100, 0x42);
      const result = createChunkedEvent({
        buffer,
        mime: "image/png",
        originDeviceId: mockDeviceId,
      });

      assert.strictEqual(result.chunkMessages.length, 2);

      // Check first chunk
      assert.strictEqual(result.chunkMessages[0].type, "clip_chunk");
      assert.strictEqual(result.chunkMessages[0].chunkIndex, 0);
      assert.strictEqual(result.chunkMessages[0].totalChunks, 2);
      assert.strictEqual(result.chunkMessages[0].eventId, result.startMessage.eventId);

      // Check second chunk
      assert.strictEqual(result.chunkMessages[1].chunkIndex, 1);

      // Verify data can be decoded back
      const decoded0 = Buffer.from(result.chunkMessages[0].data, "base64");
      const decoded1 = Buffer.from(result.chunkMessages[1].data, "base64");
      assert.strictEqual(decoded0.length, CHUNK_SIZE);
      assert.strictEqual(decoded1.length, 100);
    });

    it("should throw error for oversized images", () => {
      const buffer = Buffer.alloc(MAX_IMAGE_SIZE + 1);

      assert.throws(() => {
        createChunkedEvent({
          buffer,
          mime: "image/png",
          originDeviceId: mockDeviceId,
        });
      }, /exceeds maximum/);
    });

    it("should handle single-chunk images", () => {
      const buffer = Buffer.from("small image data");
      const result = createChunkedEvent({
        buffer,
        mime: "image/jpeg",
        originDeviceId: mockDeviceId,
      });

      assert.strictEqual(result.startMessage.totalChunks, 1);
      assert.strictEqual(result.chunkMessages.length, 1);
      assert.strictEqual(result.chunkMessages[0].chunkIndex, 0);
    });
  });
});
