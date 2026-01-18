import type { ClipStartMessage, ClipChunkMessage, SupportedImageMime } from "@universal-clipboard/protocol";

// 30 seconds timeout for incomplete transfers
const TRANSFER_TIMEOUT_MS = 30 * 1000;

// Cleanup interval for stale pending transfers
const CLEANUP_INTERVAL_MS = 10 * 1000;

type PendingTransfer = {
  startMessage: ClipStartMessage;
  chunks: Map<number, Buffer>;
  startedAt: number;
};

export type AssembledImage = {
  eventId: string;
  originDeviceId: string;
  timestampMs: number;
  mime: SupportedImageMime;
  buffer: Buffer;
};

// Collects and reassembles chunked image transfers
export class ChunkAssembler {
  private pending = new Map<string, PendingTransfer>();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.startCleanup();
  }

  // Handle a clip_start message to begin collecting chunks
  handleStart(message: ClipStartMessage): void {
    this.pending.set(message.eventId, {
      startMessage: message,
      chunks: new Map(),
      startedAt: Date.now(),
    });
  }

  // Handle a clip_chunk message. Returns assembled image if transfer is complete.
  handleChunk(message: ClipChunkMessage): AssembledImage | null {
    let transfer = this.pending.get(message.eventId);

    // If we haven't seen the start message yet, create a placeholder
    if (!transfer) {
      transfer = {
        startMessage: {
          type: "clip_start",
          eventId: message.eventId,
          originDeviceId: message.originDeviceId,
          timestampMs: Date.now(),
          mime: message.mime,
          totalBytes: 0, // Will be calculated when assembled
          totalChunks: message.totalChunks,
        },
        chunks: new Map(),
        startedAt: Date.now(),
      };
      this.pending.set(message.eventId, transfer);
    }

    // Store the chunk data
    const chunkBuffer = Buffer.from(message.data, "base64");
    transfer.chunks.set(message.chunkIndex, chunkBuffer);

    // Check if all chunks received
    if (transfer.chunks.size === message.totalChunks) {
      const assembled = this.assembleChunks(transfer, message.totalChunks);
      this.pending.delete(message.eventId);
      return assembled;
    }

    return null;
  }

  // Check if an eventId has a pending transfer
  hasPending(eventId: string): boolean {
    return this.pending.has(eventId);
  }

  // Stop the cleanup timer
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private assembleChunks(transfer: PendingTransfer, totalChunks: number): AssembledImage {
    // Collect chunks in order
    const orderedChunks: Buffer[] = [];
    for (let i = 0; i < totalChunks; i++) {
      const chunk = transfer.chunks.get(i);
      if (!chunk) {
        throw new Error(`Missing chunk ${i} for event ${transfer.startMessage.eventId}`);
      }
      orderedChunks.push(chunk);
    }

    const buffer = Buffer.concat(orderedChunks);

    return {
      eventId: transfer.startMessage.eventId,
      originDeviceId: transfer.startMessage.originDeviceId,
      timestampMs: transfer.startMessage.timestampMs,
      mime: transfer.startMessage.mime,
      buffer,
    };
  }

  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [eventId, transfer] of this.pending) {
        if (now - transfer.startedAt > TRANSFER_TIMEOUT_MS) {
          console.warn(`[ChunkAssembler] Timing out incomplete transfer ${eventId}`);
          this.pending.delete(eventId);
        }
      }
    }, CLEANUP_INTERVAL_MS);
  }
}
