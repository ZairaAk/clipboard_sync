// Simple fixed-size LRU set for deduping clip_event IDs.
export class LruSet {
  private maxSize: number;
  private order: Map<string, null>;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
    this.order = new Map();
  }

  has(value: string) {
    return this.order.has(value);
  }

  add(value: string) {
    if (this.order.has(value)) {
      this.order.delete(value);
    }
    this.order.set(value, null);

    if (this.order.size > this.maxSize) {
      const oldest = this.order.keys().next().value;
      if (oldest) {
        this.order.delete(oldest);
      }
    }
  }
}
