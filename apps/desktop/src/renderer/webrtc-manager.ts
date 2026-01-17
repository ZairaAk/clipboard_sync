// WebRTC connection manager for renderer process
// Uses browser's RTCPeerConnection API (available in Electron's Chromium)

export type ConnectionState = "disconnected" | "connecting" | "connected" | "failed";

export type WebRtcManagerConfig = {
  selfId: string;
  peerId: string;
  iceServers: RTCIceServer[];
  sendSignal: (payload: { kind: string; data: unknown }) => void;
  onStateChange?: (state: ConnectionState) => void;
  onMessage?: (data: string) => void;
};

export class WebRtcManager {
  private pc: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private state: ConnectionState = "disconnected";
  private readonly config: WebRtcManagerConfig;
  private readonly isInitiator: boolean;

  constructor(config: WebRtcManagerConfig) {
    this.config = config;
    // Initiator rule: lexicographically smaller deviceId initiates
    this.isInitiator = config.selfId < config.peerId;
    console.log(
      `[WebRTC] Initialized - selfId: ${config.selfId.slice(0, 8)}, peerId: ${config.peerId.slice(0, 8)}, isInitiator: ${this.isInitiator}`
    );
  }

  async start(): Promise<void> {
    if (this.pc) {
      console.warn("[WebRTC] Already started");
      return;
    }

    this.setState("connecting");

    this.pc = new RTCPeerConnection({
      iceServers: this.config.iceServers,
    });

    // Handle ICE candidates
    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log("[WebRTC] Sending ICE candidate");
        this.config.sendSignal({
          kind: "ice",
          data: event.candidate.toJSON(),
        });
      }
    };

    // Handle connection state changes
    this.pc.onconnectionstatechange = () => {
      console.log("[WebRTC] Connection state:", this.pc?.connectionState);
      if (this.pc?.connectionState === "failed") {
        this.setState("failed");
      } else if (this.pc?.connectionState === "disconnected") {
        this.setState("disconnected");
      }
    };

    // Handle ICE connection state
    this.pc.oniceconnectionstatechange = () => {
      console.log("[WebRTC] ICE state:", this.pc?.iceConnectionState);
    };

    // Responder receives data channel from initiator
    this.pc.ondatachannel = (event) => {
      console.log("[WebRTC] Received data channel");
      this.setupDataChannel(event.channel);
    };

    // Initiator creates offer and data channel
    if (this.isInitiator) {
      console.log("[WebRTC] Creating data channel (initiator)");
      const channel = this.pc.createDataChannel("clipboard-sync", {
        ordered: true,
      });
      this.setupDataChannel(channel);

      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      console.log("[WebRTC] Sending offer");
      this.config.sendSignal({
        kind: "offer",
        data: this.pc.localDescription?.toJSON(),
      });
    }
  }

  async handleSignal(payload: { kind: string; data: unknown }): Promise<void> {
    if (!this.pc) {
      console.warn("[WebRTC] Received signal but PC not initialized");
      // Auto-start if we receive a signal (responder case)
      await this.start();
    }

    try {
      if (payload.kind === "offer") {
        console.log("[WebRTC] Received offer");
        await this.pc!.setRemoteDescription(payload.data as RTCSessionDescriptionInit);
        const answer = await this.pc!.createAnswer();
        await this.pc!.setLocalDescription(answer);
        console.log("[WebRTC] Sending answer");
        this.config.sendSignal({
          kind: "answer",
          data: this.pc!.localDescription?.toJSON(),
        });
      } else if (payload.kind === "answer") {
        console.log("[WebRTC] Received answer");
        await this.pc!.setRemoteDescription(payload.data as RTCSessionDescriptionInit);
      } else if (payload.kind === "ice") {
        console.log("[WebRTC] Received ICE candidate");
        await this.pc!.addIceCandidate(payload.data as RTCIceCandidateInit);
      }
    } catch (err) {
      console.error("[WebRTC] Error handling signal:", err);
      this.setState("failed");
    }
  }

  send(data: string): boolean {
    if (!this.dataChannel || this.dataChannel.readyState !== "open") {
      console.warn("[WebRTC] Cannot send - channel not open");
      return false;
    }
    this.dataChannel.send(data);
    return true;
  }

  getState(): ConnectionState {
    return this.state;
  }

  close(): void {
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    this.setState("disconnected");
  }

  private setupDataChannel(channel: RTCDataChannel): void {
    this.dataChannel = channel;

    channel.onopen = () => {
      console.log("[WebRTC] Data channel open!");
      this.setState("connected");
    };

    channel.onclose = () => {
      console.log("[WebRTC] Data channel closed");
      this.setState("disconnected");
    };

    channel.onerror = (err) => {
      console.error("[WebRTC] Data channel error:", err);
      this.setState("failed");
    };

    channel.onmessage = (event) => {
      console.log("[WebRTC] Received message:", event.data.slice(0, 100));
      this.config.onMessage?.(event.data);
    };
  }

  private setState(state: ConnectionState): void {
    if (this.state !== state) {
      console.log(`[WebRTC] State: ${this.state} -> ${state}`);
      this.state = state;
      this.config.onStateChange?.(state);
    }
  }
}
