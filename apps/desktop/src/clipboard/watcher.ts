import { clipboard } from "electron";

export type ClipboardWatcherOptions = {
  pollIntervalMs: number;
  onText: (text: string) => void;
  shouldSuppress: () => boolean;
};

// Poll the OS clipboard for text changes.
export class ClipboardWatcher {
  private timer: NodeJS.Timeout | null = null;
  private lastText = "";
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

      const text = clipboard.readText();
      if (text && text !== this.lastText) {
        this.lastText = text;
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
  }
}
