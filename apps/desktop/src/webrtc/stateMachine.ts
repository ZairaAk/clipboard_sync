import type { ConnectionState } from "./types";

export type StateEvent = "start" | "datachannel_open" | "error" | "disconnect";

// Transition table for the WebRTC connection state machine.
export function transitionState(
  current: ConnectionState,
  event: StateEvent,
): ConnectionState {
  switch (current) {
    case "DISCONNECTED":
      if (event === "start") {
        return "CONNECTING";
      }
      return current;
    case "CONNECTING":
      if (event === "datachannel_open") {
        return "CONNECTED";
      }
      if (event === "error") {
        return "FAILED";
      }
      return current;
    case "CONNECTED":
      if (event === "disconnect") {
        return "DISCONNECTED";
      }
      if (event === "error") {
        return "FAILED";
      }
      return current;
    case "FAILED":
      if (event === "disconnect") {
        return "DISCONNECTED";
      }
      return current;
    default:
      return current;
  }
}
