import crypto from "node:crypto";
import { clipboard, NativeImage } from "electron";

export type ClipboardWatcherOptions = {
  pollIntervalMs: number;
  onText: (text: string) => void;
  onImage: (image: NativeImage) => void;
  shouldSuppress: () => boolean;
};

// Poll the OS clipboard for text and image changes.
export class ClipboardWatcher {
  private timer: NodeJS.Timeout | null = null;
  private lastText = "";
  private lastImageHash = "";
  private options: ClipboardWatcherOptions;

  constructor(options: ClipboardWatcherOptions) {
    this.options = options;
  }

  start() {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      if (this.options.shouldSuppress()) {
        return;
      }

      // Check for image first (images take priority)
      const image = clipboard.readImage();
      if (!image.isEmpty()) {
        const imageHash = this.hashImage(image);
        if (imageHash !== this.lastImageHash) {
          this.lastImageHash = imageHash;
          this.lastText = ""; // Clear text state when image is copied
          this.options.onImage(image);
          return;
        }
      }

      // Check for text
      const text = clipboard.readText();
      if (text && text !== this.lastText) {
        this.lastText = text;
        this.lastImageHash = ""; // Clear image state when text is copied
        this.options.onText(text);
      }
    }, this.options.pollIntervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // Update the last seen clipboard text to avoid loops after remote apply.
  setLastText(text: string) {
    this.lastText = text;
    this.lastImageHash = ""; // Clear image state
  }

  // Update the last seen image hash to avoid loops after remote apply.
  setLastImageHash(hash: string) {
    this.lastImageHash = hash;
    this.lastText = ""; // Clear text state
  }

  private hashImage(image: NativeImage): string {
    const buffer = image.toPNG();
    return crypto.createHash("sha256").update(buffer).digest("hex");
  }
}
