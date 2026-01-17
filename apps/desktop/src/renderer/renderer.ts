// IIFE to avoid scope conflicts
(function() {

// WebRTC Manager (inlined to avoid module issues)
type RtcConnectionState = "disconnected" | "connecting" | "connected" | "failed";

type WebRtcManagerConfig = {
  selfId: string;
  peerId: string;
  iceServers: RTCIceServer[];
  sendSignal: (payload: { kind: string; data: unknown }) => void;
  onStateChange?: (state: RtcConnectionState) => void;
  onMessage?: (data: string) => void;
};

class WebRtcManager {
  private pc: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private state: RtcConnectionState = "disconnected";
  private readonly config: WebRtcManagerConfig;
  private readonly isInitiator: boolean;

  constructor(config: WebRtcManagerConfig) {
    this.config = config;
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

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log("[WebRTC] Sending ICE candidate");
        this.config.sendSignal({
          kind: "ice",
          data: event.candidate.toJSON(),
        });
      }
    };

    this.pc.onconnectionstatechange = () => {
      console.log("[WebRTC] Connection state:", this.pc?.connectionState);
      if (this.pc?.connectionState === "failed") {
        this.setState("failed");
      } else if (this.pc?.connectionState === "disconnected") {
        this.setState("disconnected");
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      console.log("[WebRTC] ICE state:", this.pc?.iceConnectionState);
    };

    this.pc.ondatachannel = (event) => {
      console.log("[WebRTC] Received data channel");
      this.setupDataChannel(event.channel);
    };

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

  getState(): RtcConnectionState {
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

  private setState(state: RtcConnectionState): void {
    if (this.state !== state) {
      console.log(`[WebRTC] State: ${this.state} -> ${state}`);
      this.state = state;
      this.config.onStateChange?.(state);
    }
  }
}

// Type definition for the exposed API
interface UcApi {
  platform: string;
  connect: (config: { serverUrl: string; deviceId: string }) => Promise<{ success: boolean }>;
  disconnect: () => Promise<{ success: boolean }>;
  getConnectionState: () => Promise<{
    wsStatus: string;
    pairCode: string | null;
    pairedPeerId: string | null;
  }>;
  pairCreate: () => Promise<{ success: boolean; error?: string }>;
  pairJoin: (code: string) => Promise<{ success: boolean; error?: string }>;
  sendSignal: (to: string, payload: { kind: string; data: unknown }) => Promise<{ success: boolean }>;
  getIceServers: () => Promise<RTCIceServer[]>;
  onWsStatus: (callback: (status: string) => void) => () => void;
  onDevicesUpdate: (callback: (msg: unknown) => void) => () => void;
  onPairCreated: (callback: (msg: { code: string; expiresAt: number }) => void) => () => void;
  onPairPaired: (callback: (msg: { a: string; b: string; peerId: string }) => void) => () => void;
  onSignal: (callback: (msg: { from: string; payload: { kind: string; data: unknown } }) => void) => () => void;
  onError: (callback: (msg: { code: string; message: string }) => void) => () => void;
}

const uc = (window as any).uc as UcApi;

// Elements
const deviceIdEl = document.getElementById("deviceId")!;
const statusDot = document.getElementById("statusDot")!;
const statusText = document.getElementById("statusText")!;
const serverUrlInput = document.getElementById("serverUrl") as HTMLInputElement;
const connectBtn = document.getElementById("connectBtn")!;
const pairingSection = document.getElementById("pairingSection")!;
const pairOptions = document.getElementById("pairOptions")!;
const createdCodeView = document.getElementById("createdCodeView")!;
const joinCodeView = document.getElementById("joinCodeView")!;
const createCodeBtn = document.getElementById("createCodeBtn")!;
const showJoinBtn = document.getElementById("showJoinBtn")!;
const pairCodeDisplay = document.getElementById("pairCodeDisplay")!;
const cancelCreateBtn = document.getElementById("cancelCreateBtn")!;
const joinCodeInput = document.getElementById("joinCodeInput") as HTMLInputElement;
const joinBtn = document.getElementById("joinBtn")!;
const cancelJoinBtn = document.getElementById("cancelJoinBtn")!;
const errorMsg = document.getElementById("errorMsg")!;
const pairedSection = document.getElementById("pairedSection")!;
const peerIdEl = document.getElementById("peerId")!;
const sendPingBtn = document.getElementById("sendPingBtn");
const pingResult = document.getElementById("pingResult");

// State
let deviceId: string | null = null;
let wsStatus: "disconnected" | "connecting" | "connected" = "disconnected";
let webrtc: WebRtcManager | null = null;
let currentPeerId: string | null = null;

function generateDeviceId(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function getOrCreateDeviceId(): string {
  let id = localStorage.getItem("deviceId");
  if (!id) {
    id = generateDeviceId();
    localStorage.setItem("deviceId", id);
  }
  return id;
}

function updateStatusUI(status: string) {
  wsStatus = status as typeof wsStatus;
  statusDot.className = `status-dot ${status}`;
  statusText.textContent = status.charAt(0).toUpperCase() + status.slice(1);

  if (status === "connected") {
    connectBtn.textContent = "Disconnect";
    pairingSection.classList.remove("hidden");
  } else {
    connectBtn.textContent = "Connect";
    pairingSection.classList.add("hidden");
    pairedSection.classList.add("hidden");
    resetPairingView();
  }
}

function resetPairingView() {
  pairOptions.classList.remove("hidden");
  createdCodeView.classList.add("hidden");
  joinCodeView.classList.add("hidden");
  errorMsg.classList.add("hidden");
  joinCodeInput.value = "";
}

function showError(message: string) {
  errorMsg.textContent = message;
  errorMsg.classList.remove("hidden");
}

function updateWebRtcStatus(state: string) {
  const rtcStatusEl = document.getElementById("rtcStatus");
  const connectedActions = document.getElementById("connectedActions");
  if (rtcStatusEl) {
    rtcStatusEl.textContent = state.charAt(0).toUpperCase() + state.slice(1);
    rtcStatusEl.className = `rtc-status ${state}`;
  }
  if (connectedActions) {
    if (state === "connected") {
      connectedActions.classList.remove("hidden");
    } else {
      connectedActions.classList.add("hidden");
    }
  }
}

function handleDataChannelMessage(data: string) {
  try {
    const msg = JSON.parse(data);
    if (msg.type === "ping") {
      console.log("[Renderer] Received ping, sending pong");
      webrtc?.send(JSON.stringify({ type: "pong", ts: Date.now() }));
      if (pingResult) {
        pingResult.textContent = "Ping received! Pong sent.";
      }
    } else if (msg.type === "pong") {
      console.log("[Renderer] Received pong - connection verified!");
      if (pingResult) {
        pingResult.textContent = "Pong received! Connection works!";
        pingResult.style.color = "#4ade80";
      }
    }
  } catch (err) {
    console.error("[Renderer] Failed to parse DataChannel message:", err);
  }
}

// Initialize
deviceId = getOrCreateDeviceId();
deviceIdEl.textContent = `Device ID: ${deviceId}`;

// Event handlers
connectBtn.addEventListener("click", async () => {
  if (wsStatus === "connected") {
    await uc.disconnect();
  } else {
    const serverUrl = serverUrlInput.value.trim();
    if (!serverUrl) {
      showError("Please enter a server URL");
      return;
    }
    await uc.connect({ serverUrl, deviceId: deviceId! });
  }
});

createCodeBtn.addEventListener("click", async () => {
  errorMsg.classList.add("hidden");
  const result = await uc.pairCreate();
  if (!result.success) {
    showError(result.error || "Failed to create pairing code");
    return;
  }
  pairOptions.classList.add("hidden");
  createdCodeView.classList.remove("hidden");
  pairCodeDisplay.textContent = "------";
});

showJoinBtn.addEventListener("click", () => {
  errorMsg.classList.add("hidden");
  pairOptions.classList.add("hidden");
  joinCodeView.classList.remove("hidden");
  joinCodeInput.focus();
});

cancelCreateBtn.addEventListener("click", () => {
  resetPairingView();
});

cancelJoinBtn.addEventListener("click", () => {
  resetPairingView();
});

joinBtn.addEventListener("click", async () => {
  const code = joinCodeInput.value.trim();
  if (!/^\d{6}$/.test(code)) {
    showError("Please enter a 6-digit code");
    return;
  }
  errorMsg.classList.add("hidden");
  const result = await uc.pairJoin(code);
  if (!result.success) {
    showError(result.error || "Failed to join");
  }
});

joinCodeInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    joinBtn.click();
  }
});

joinCodeInput.addEventListener("input", () => {
  joinCodeInput.value = joinCodeInput.value.replace(/\D/g, "").slice(0, 6);
});

sendPingBtn?.addEventListener("click", () => {
  if (webrtc && webrtc.getState() === "connected") {
    const sent = webrtc.send(JSON.stringify({ type: "ping", ts: Date.now() }));
    if (sent && pingResult) {
      pingResult.textContent = "Ping sent...";
    }
  }
});

// IPC event listeners
uc.onWsStatus(updateStatusUI);

uc.onPairCreated((msg: { code: string; expiresAt: number }) => {
  pairCodeDisplay.textContent = msg.code;
});

uc.onPairPaired(async (msg: { a: string; b: string; peerId: string }) => {
  console.log("[Renderer] Paired with:", msg.peerId);
  currentPeerId = msg.peerId;

  pairingSection.classList.add("hidden");
  pairedSection.classList.remove("hidden");
  peerIdEl.textContent = msg.peerId.slice(0, 8) + "...";
  updateWebRtcStatus("connecting");

  try {
    const iceServers = await uc.getIceServers();
    console.log("[Renderer] ICE servers:", iceServers);

    webrtc = new WebRtcManager({
      selfId: deviceId!,
      peerId: msg.peerId,
      iceServers,
      sendSignal: (payload) => {
        uc.sendSignal(msg.peerId, payload);
      },
      onStateChange: (state) => {
        console.log("[Renderer] WebRTC state:", state);
        updateWebRtcStatus(state);
      },
      onMessage: (data) => {
        console.log("[Renderer] Received via DataChannel:", data);
        handleDataChannelMessage(data);
      },
    });

    await webrtc.start();
  } catch (err) {
    console.error("[Renderer] WebRTC start error:", err);
    updateWebRtcStatus("failed");
  }
});

uc.onError((msg: { code: string; message: string }) => {
  showError(msg.message);
});

uc.onSignal(async (msg: { from: string; payload: { kind: string; data: unknown } }) => {
  console.log("[Renderer] Signal received from:", msg.from);
  if (!webrtc && currentPeerId === msg.from) {
    try {
      const iceServers = await uc.getIceServers();
      webrtc = new WebRtcManager({
        selfId: deviceId!,
        peerId: msg.from,
        iceServers,
        sendSignal: (payload) => {
          uc.sendSignal(msg.from, payload);
        },
        onStateChange: (state) => {
          console.log("[Renderer] WebRTC state:", state);
          updateWebRtcStatus(state);
        },
        onMessage: (data) => {
          console.log("[Renderer] Received via DataChannel:", data);
          handleDataChannelMessage(data);
        },
      });
    } catch (err) {
      console.error("[Renderer] WebRTC init error:", err);
      return;
    }
  }

  if (webrtc) {
    await webrtc.handleSignal(msg.payload);
  }
});

})(); // End IIFE
