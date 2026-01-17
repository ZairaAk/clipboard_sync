import { transitionState } from "./stateMachine";
import type {
  ConnectionState,
  DataChannel,
  PeerAdapter,
  SignalMessage,
  SignalPayload,
} from "./types";

export type WebRtcLinkOptions = {
  selfId: string;
  peerId: string;
  isInitiator: boolean;
  peer: PeerAdapter;
  sendSignal: (message: SignalMessage) => void;
  onStateChange?: (state: ConnectionState) => void;
};

// Manage a single WebRTC connection and its signaling flow.
export class WebRtcLink {
  private state: ConnectionState = "DISCONNECTED";
  private readonly selfId: string;
  private readonly peerId: string;
  private readonly isInitiator: boolean;
  private readonly peer: PeerAdapter;
  private readonly sendSignal: (message: SignalMessage) => void;
  private readonly onStateChange?: (state: ConnectionState) => void;
  private dataChannel: DataChannel | null = null;

  constructor(options: WebRtcLinkOptions) {
    this.selfId = options.selfId;
    this.peerId = options.peerId;
    this.isInitiator = options.isInitiator;
    this.peer = options.peer;
    this.sendSignal = options.sendSignal;
    this.onStateChange = options.onStateChange;

    // Wire ICE candidates to signaling as they are generated.
    this.peer.onicecandidate = (candidate) => {
      if (candidate?.candidate) {
        this.emitSignal({ kind: "ice", data: candidate });
      }
    };

    // Responder waits for the initiator's data channel.
    this.peer.ondatachannel = (channel) => {
      this.attachDataChannel(channel);
    };
  }

  getState() {
    return this.state;
  }

  // Begin the connection; initiator creates the offer and data channel.
  async start() {
    this.setState(transitionState(this.state, "start"));

    if (this.isInitiator) {
      this.attachDataChannel(this.peer.createDataChannel("uc-data"));
      await this.createAndSendOffer();
    }
  }

  // Handle incoming signaling messages (offer/answer/ice).
  async handleSignal(message: SignalMessage) {
    const payload = message.payload;
    if (payload.kind === "offer") {
      await this.peer.setRemoteDescription(payload.data as any);
      if (!this.isInitiator) {
        await this.createAndSendAnswer();
      }
      return;
    }

    if (payload.kind === "answer") {
      await this.peer.setRemoteDescription(payload.data as any);
      return;
    }

    if (payload.kind === "ice") {
      await this.peer.addIceCandidate(payload.data as any);
    }
  }

  private attachDataChannel(channel: DataChannel) {
    this.dataChannel = channel;
    channel.onopen = () => this.setState(transitionState(this.state, "datachannel_open"));
    channel.onclose = () => this.setState(transitionState(this.state, "disconnect"));
  }

  private async createAndSendOffer() {
    try {
      const offer = await this.peer.createOffer();
      await this.peer.setLocalDescription(offer);
      this.emitSignal({ kind: "offer", data: offer });
    } catch {
      this.setState(transitionState(this.state, "error"));
    }
  }

  private async createAndSendAnswer() {
    try {
      const answer = await this.peer.createAnswer();
      await this.peer.setLocalDescription(answer);
      this.emitSignal({ kind: "answer", data: answer });
    } catch {
      this.setState(transitionState(this.state, "error"));
    }
  }

  private emitSignal(payload: SignalPayload) {
    this.sendSignal({
      type: "signal",
      to: this.peerId,
      from: this.selfId,
      payload,
    });
  }

  private setState(next: ConnectionState) {
    if (next === this.state) {
      return;
    }

    this.state = next;
    this.onStateChange?.(next);
  }
}
