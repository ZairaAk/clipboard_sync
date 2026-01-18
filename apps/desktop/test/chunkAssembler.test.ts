import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { ChunkAssembler } from "../src/clipboard/chunkAssembler";
import { chunkBuffer, createChunkedEvent, CHUNK_SIZE } from "../src/clipboard/chunker";
import type { ClipStartMessage, ClipChunkMessage } from "@universal-clipboard/protocol";

describe("ChunkAssembler", () => {
  let assembler: ChunkAssembler;

  beforeEach(() => {
    assembler = new ChunkAssembler();
  });

  afterEach(() => {
    assembler.stop();
  });

  const mockDeviceId = "12345678-1234-4123-8123-123456789abc";

  describe("handleStart", () => {
    it("should register pending transfer", () => {
      const startMessage: ClipStartMessage = {
        type: "clip_start",
        eventId: "test-event-1",
        originDeviceId: mockDeviceId,
        timestampMs: Date.now(),
        mime: "image/png",
        totalBytes: 1000,
        totalChunks: 2,
      };

      assembler.handleStart(startMessage);
      assert.ok(assembler.hasPending("test-event-1"));
    });
  });

  describe("handleChunk", () => {
    it("should return null until all chunks received", () => {
      const buffer = Buffer.alloc(CHUNK_SIZE * 2, 0x42);
      const { startMessage, chunkMessages } = createChunkedEvent({
        buffer,
        mime: "image/png",
        originDeviceId: mockDeviceId,
      });

      assembler.handleStart(startMessage);

      // First chunk should not complete transfer
      const result1 = assembler.handleChunk(chunkMessages[0]);
      assert.strictEqual(result1, null);
      assert.ok(assembler.hasPending(startMessage.eventId));
    });

    it("should return assembled image when all chunks received", () => {
      const originalBuffer = Buffer.alloc(CHUNK_SIZE + 100);
      for (let i = 0; i < originalBuffer.length; i++) {
        originalBuffer[i] = i % 256;
      }

      const { startMessage, chunkMessages } = createChunkedEvent({
        buffer: originalBuffer,
        mime: "image/png",
        originDeviceId: mockDeviceId,
      });

      assembler.handleStart(startMessage);
      assembler.handleChunk(chunkMessages[0]);
      const result = assembler.handleChunk(chunkMessages[1]);

      assert.ok(result !== null);
      assert.strictEqual(result!.eventId, startMessage.eventId);
      assert.strictEqual(result!.mime, "image/png");
      assert.strictEqual(result!.originDeviceId, mockDeviceId);
      assert.ok(Buffer.compare(result!.buffer, originalBuffer) === 0);
    });

    it("should handle out-of-order chunk delivery", () => {
      const originalBuffer = Buffer.alloc(CHUNK_SIZE * 3);
      for (let i = 0; i < originalBuffer.length; i++) {
        originalBuffer[i] = i % 256;
      }

      const { startMessage, chunkMessages } = createChunkedEvent({
        buffer: originalBuffer,
        mime: "image/png",
        originDeviceId: mockDeviceId,
      });

      assembler.handleStart(startMessage);

      // Send chunks out of order: 2, 0, 1
      assembler.handleChunk(chunkMessages[2]);
      assembler.handleChunk(chunkMessages[0]);
      const result = assembler.handleChunk(chunkMessages[1]);

      assert.ok(result !== null);
      assert.ok(Buffer.compare(result!.buffer, originalBuffer) === 0);
    });

    it("should handle chunks without prior start message", () => {
      const originalBuffer = Buffer.alloc(100);
      for (let i = 0; i < originalBuffer.length; i++) {
        originalBuffer[i] = i;
      }

      const { chunkMessages } = createChunkedEvent({
        buffer: originalBuffer,
        mime: "image/jpeg",
        originDeviceId: mockDeviceId,
      });

      // Send chunk without start message - assembler should create placeholder
      const result = assembler.handleChunk(chunkMessages[0]);

      assert.ok(result !== null);
      assert.ok(Buffer.compare(result!.buffer, originalBuffer) === 0);
    });

    it("should clean up pending transfer after completion", () => {
      const buffer = Buffer.alloc(100);
      const { startMessage, chunkMessages } = createChunkedEvent({
        buffer,
        mime: "image/png",
        originDeviceId: mockDeviceId,
      });

      assembler.handleStart(startMessage);
      assembler.handleChunk(chunkMessages[0]);

      assert.ok(!assembler.hasPending(startMessage.eventId));
    });
  });

  describe("roundtrip test", () => {
    it("should correctly reassemble various sized images", () => {
      const testSizes = [1, 100, CHUNK_SIZE - 1, CHUNK_SIZE, CHUNK_SIZE + 1, CHUNK_SIZE * 5 + 500];

      for (const size of testSizes) {
        const assembler = new ChunkAssembler();
        const originalBuffer = Buffer.alloc(size);
        for (let i = 0; i < size; i++) {
          originalBuffer[i] = i % 256;
        }

        const { startMessage, chunkMessages } = createChunkedEvent({
          buffer: originalBuffer,
          mime: "image/png",
          originDeviceId: mockDeviceId,
        });

        assembler.handleStart(startMessage);

        let result = null;
        for (const chunk of chunkMessages) {
          result = assembler.handleChunk(chunk);
        }

        assert.ok(result !== null, `Failed for size ${size}`);
        assert.ok(
          Buffer.compare(result!.buffer, originalBuffer) === 0,
          `Buffer mismatch for size ${size}`
        );

        assembler.stop();
      }
    });
  });
});
