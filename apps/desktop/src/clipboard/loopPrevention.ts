import { LruSet } from "./lruSet";

// Loop prevention helper: eventId dedupe + suppress local watcher after apply.
export class LoopPrevention {
  private suppressUntilMs = 0;
  private seenEventIds = new LruSet(2000);

  shouldSuppressLocal(now = Date.now()) {
    return now < this.suppressUntilMs;
  }

  markRemoteApplied(durationMs = 500, now = Date.now()) {
    this.suppressUntilMs = now + durationMs;
  }

  hasSeen(eventId: string) {
    return this.seenEventIds.has(eventId);
  }

  remember(eventId: string) {
    this.seenEventIds.add(eventId);
  }
}
