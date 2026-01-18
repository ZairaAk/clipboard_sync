import crypto from "node:crypto";
import type { ClipStartMessage, ClipChunkMessage, SupportedImageMime } from "@universal-clipboard/protocol";

// 12KB raw data becomes ~16KB after base64 encoding (safe for WebRTC)
export const CHUNK_SIZE = 12 * 1024;

// Maximum image size we'll handle (10MB)
export const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

export type ChunkedImageEvent = {
  startMessage: ClipStartMessage;
  chunkMessages: ClipChunkMessage[];
};

// Split a buffer into chunks of CHUNK_SIZE bytes
export function chunkBuffer(buffer: Buffer): Buffer[] {
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < buffer.length; offset += CHUNK_SIZE) {
    chunks.push(buffer.subarray(offset, offset + CHUNK_SIZE));
  }
  return chunks;
}

// Create a complete chunked event with start message and all chunk messages
export function createChunkedEvent(params: {
  buffer: Buffer;
  mime: SupportedImageMime;
  originDeviceId: string;
}): ChunkedImageEvent {
  const { buffer, mime, originDeviceId } = params;

  if (buffer.length > MAX_IMAGE_SIZE) {
    throw new Error(`Image size ${buffer.length} exceeds maximum ${MAX_IMAGE_SIZE}`);
  }

  const eventId = crypto.randomUUID();
  const timestampMs = Date.now();
  const chunks = chunkBuffer(buffer);
  const totalChunks = chunks.length;

  const startMessage: ClipStartMessage = {
    type: "clip_start",
    eventId,
    originDeviceId,
    timestampMs,
    mime,
    totalBytes: buffer.length,
    totalChunks,
  };

  const chunkMessages: ClipChunkMessage[] = chunks.map((chunk, index) => ({
    type: "clip_chunk",
    eventId,
    originDeviceId,
    chunkIndex: index,
    totalChunks,
    mime,
    data: chunk.toString("base64"),
  }));

  return { startMessage, chunkMessages };
}
