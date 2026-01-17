// Minimal RTC types for running in Node tests without DOM lib types.
export type ConnectionState = "DISCONNECTED" | "CONNECTING" | "CONNECTED" | "FAILED";

export type SessionDescription = {
  type: "offer" | "answer";
  sdp: string;
};

export type IceCandidate = {
  candidate: string;
};

export type DataChannel = {
  onopen: null | (() => void);
  onclose: null | (() => void);
};

export type PeerAdapter = {
  createDataChannel: (label: string) => DataChannel;
  createOffer: () => Promise<SessionDescription>;
  createAnswer: () => Promise<SessionDescription>;
  setLocalDescription: (desc: SessionDescription) => Promise<void>;
  setRemoteDescription: (desc: SessionDescription) => Promise<void>;
  addIceCandidate: (candidate: IceCandidate) => Promise<void>;
  onicecandidate: null | ((candidate: IceCandidate) => void);
  ondatachannel: null | ((channel: DataChannel) => void);
};

export type SignalPayload = {
  kind: "offer" | "answer" | "ice";
  data: SessionDescription | IceCandidate;
};

export type SignalMessage = {
  type: "signal";
  to: string;
  from: string;
  payload: SignalPayload;
};
