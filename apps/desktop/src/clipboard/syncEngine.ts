import crypto from "node:crypto";
import { clipboard } from "electron";
import type { ClipEventMessage } from "@universal-clipboard/protocol";
import { HistoryStore } from "./historyStore";
import { ClipboardWatcher } from "./watcher";
import { LoopPrevention } from "./loopPrevention";

export type ClipTransport = {
  send: (event: ClipEventMessage) => void;
};

export type ClipboardSyncOptions = {
  deviceId: string;
  transport: ClipTransport;
  history: HistoryStore;
};

// Syncs clipboard text changes over a transport and records history.
export class ClipboardSyncEngine {
  private deviceId: string;
  private transport: ClipTransport;
  private history: HistoryStore;
  private loop: LoopPrevention;
  private watcher: ClipboardWatcher;
  onHistoryUpdated?: () => void;

  constructor(options: ClipboardSyncOptions) {
    this.deviceId = options.deviceId;
    this.transport = options.transport;
    this.history = options.history;
    this.loop = new LoopPrevention();

    this.watcher = new ClipboardWatcher({
      pollIntervalMs: 300,
      shouldSuppress: () => this.loop.shouldSuppressLocal(),
      onText: (text) => this.handleLocalText(text),
    });
  }

  start() {
    this.watcher.start();
  }

  stop() {
    this.watcher.stop();
  }

  async handleRemoteEvent(event: ClipEventMessage) {
    if (event.originDeviceId === this.deviceId) {
      return;
    }

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
}
