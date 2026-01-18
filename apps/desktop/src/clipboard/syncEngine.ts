import crypto from "node:crypto";
import { clipboard, nativeImage, NativeImage } from "electron";
import type { ClipEventMessage, ClipStartMessage, ClipChunkMessage, SupportedImageMime } from "@universal-clipboard/protocol";
import { SUPPORTED_IMAGE_MIMES } from "@universal-clipboard/protocol";
import { HistoryStore } from "./historyStore";
import { ClipboardWatcher } from "./watcher";
import { LoopPrevention } from "./loopPrevention";
import { createChunkedEvent, MAX_IMAGE_SIZE } from "./chunker";
import { ChunkAssembler, AssembledImage } from "./chunkAssembler";

export type ClipMessage = ClipEventMessage | ClipStartMessage | ClipChunkMessage;

export type ClipTransport = {
  send: (event: ClipMessage) => void;
};

export type ClipboardSyncOptions = {
  deviceId: string;
  transport: ClipTransport;
  history: HistoryStore;
};

// Syncs clipboard text and image changes over a transport and records history.
export class ClipboardSyncEngine {
  private deviceId: string;
  private transport: ClipTransport;
  private history: HistoryStore;
  private loop: LoopPrevention;
  private watcher: ClipboardWatcher;
  private chunkAssembler: ChunkAssembler;
  onHistoryUpdated?: () => void;

  constructor(options: ClipboardSyncOptions) {
    this.deviceId = options.deviceId;
    this.transport = options.transport;
    this.history = options.history;
    this.loop = new LoopPrevention();
    this.chunkAssembler = new ChunkAssembler();

    this.watcher = new ClipboardWatcher({
      pollIntervalMs: 300,
      shouldSuppress: () => this.loop.shouldSuppressLocal(),
      onText: (text) => this.handleLocalText(text),
      onImage: (image) => this.handleLocalImage(image),
    });
  }

  start() {
    this.watcher.start();
  }

  stop() {
    this.watcher.stop();
    this.chunkAssembler.stop();
  }

  async handleRemoteEvent(event: ClipMessage) {
    if (event.originDeviceId === this.deviceId) {
      return;
    }

    // Handle clip_start messages (image transfer metadata)
    if (event.type === "clip_start") {
      if (this.loop.hasSeen(event.eventId)) {
        return;
      }
      this.loop.remember(event.eventId);
      this.chunkAssembler.handleStart(event);
      return;
    }

    // Handle clip_chunk messages (image data chunks)
    if (event.type === "clip_chunk") {
      if (this.loop.hasSeen(event.eventId) && !this.chunkAssembler.hasPending(event.eventId)) {
        return;
      }
      if (!this.loop.hasSeen(event.eventId)) {
        this.loop.remember(event.eventId);
      }

      const assembled = this.chunkAssembler.handleChunk(event);
      if (assembled) {
        await this.applyRemoteImage(assembled);
      }
      return;
    }

    // Handle regular clip_event messages (text)
    if (event.type === "clip_event") {
      if (this.loop.hasSeen(event.eventId)) {
        return;
      }

      this.loop.remember(event.eventId);

      if (event.mime !== "text/plain") {
        return;
      }

      const text = Buffer.from(event.ciphertext, "base64").toString("utf8");
      clipboard.writeText(text);
      this.watcher.setLastText(text);
      this.loop.markRemoteApplied();

      await this.history.upsertText({
        text,
        source: "remote",
        originDeviceId: event.originDeviceId,
      });
      this.onHistoryUpdated?.();
    }
  }

  private async applyRemoteImage(assembled: AssembledImage) {
    const image = nativeImage.createFromBuffer(assembled.buffer);
    if (image.isEmpty()) {
      console.warn("[SyncEngine] Failed to create image from assembled buffer");
      return;
    }

    clipboard.writeImage(image);

    // Calculate hash to prevent loop
    const imageHash = crypto.createHash("sha256").update(assembled.buffer).digest("hex");
    this.watcher.setLastImageHash(imageHash);
    this.loop.markRemoteApplied();

    await this.history.upsertImage({
      buffer: assembled.buffer,
      mime: assembled.mime,
      source: "remote",
      originDeviceId: assembled.originDeviceId,
    });
    this.onHistoryUpdated?.();
  }

  private async handleLocalText(text: string) {
    const nonce = crypto.randomBytes(12).toString("base64");
    const event: ClipEventMessage = {
      type: "clip_event",
      eventId: crypto.randomUUID(),
      originDeviceId: this.deviceId,
      timestampMs: Date.now(),
      mime: "text/plain",
      nonce,
      ciphertext: Buffer.from(text, "utf8").toString("base64"),
    };

    this.loop.remember(event.eventId);
    this.transport.send(event);

    await this.history.upsertText({
      text,
      source: "local",
      originDeviceId: this.deviceId,
    });
    this.onHistoryUpdated?.();
  }

  private async handleLocalImage(image: NativeImage) {
    const buffer = image.toPNG();

    // Check size limit
    if (buffer.length > MAX_IMAGE_SIZE) {
      console.warn(`[SyncEngine] Image too large (${buffer.length} bytes), skipping sync`);
      return;
    }

    const mime: SupportedImageMime = "image/png";

    // Create chunked event
    const { startMessage, chunkMessages } = createChunkedEvent({
      buffer,
      mime,
      originDeviceId: this.deviceId,
    });

    // Remember event to prevent loops
    this.loop.remember(startMessage.eventId);

    // Send start message first, then all chunks
    this.transport.send(startMessage);
    for (const chunk of chunkMessages) {
      this.transport.send(chunk);
    }

    // Store in history
    await this.history.upsertImage({
      buffer,
      mime,
      source: "local",
      originDeviceId: this.deviceId,
    });
    this.onHistoryUpdated?.();
  }
}
