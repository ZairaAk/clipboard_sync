// Canonical error codes used by the WebSocket control plane.
export const ERROR_CODES = {
  INVALID_MESSAGE: "invalid_message",
  RATE_LIMITED: "rate_limited",
  PAIR_CODE_EXPIRED: "pair_code_expired",
  PAIR_CODE_NOT_FOUND: "pair_code_not_found",
  PAIR_CODE_ALREADY_USED: "pair_code_already_used",
  PEER_NOT_CONNECTED: "peer_not_connected",
  NOT_PAIRED: "not_paired",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
