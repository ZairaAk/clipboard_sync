type HistoryItem = {
  id: string;
  preview: string;
  lastSeen: number;
};

type Identity = {
  deviceId: string;
  deviceName: string;
  platform: "windows" | "mac" | "linux";
  publicKey: string;
};

type SignalPayload = {
  kind: "offer" | "answer" | "ice";
  data: any;
};

type SignalMessage = {
  type: "signal";
  to: string;
  from: string;
  payload: SignalPayload;
};

type ClipEventMessage = {
  type: "clip_event";
  eventId: string;
  originDeviceId: string;
  timestampMs: number;
  mime: string;
  nonce: string;
  ciphertext: string;
};

const statusEl = document.getElementById("status");
const historyListEl = document.getElementById("history-list");
const connectionStatusEl = document.getElementById("connection-status");
const pairCreateButton = document.getElementById("pair-create");
const pairJoinButton = document.getElementById("pair-join");
const pairJoinInput = document.getElementById("pair-join-code") as HTMLInputElement | null;
const pairCodeEl = document.getElementById("pair-code");
const pairErrorEl = document.getElementById("pair-error");

// Render a simple status message to confirm preload/renderer wiring.
const platform = (window as any).uc?.platform ?? "unknown";
if (statusEl) {
  statusEl.textContent = `Desktop app ready on ${platform}.`;
}

function renderHistory(items: HistoryItem[]) {
  if (!historyListEl) {
    return;
  }

  historyListEl.innerHTML = "";
  if (items.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = "No history yet.";
    historyListEl.appendChild(empty);
    return;
  }

  items.forEach((item) => {
    const row = document.createElement("li");
    row.textContent = `${item.preview} · ${new Date(item.lastSeen).toLocaleString()}`;
    historyListEl.appendChild(row);
  });
}

async function refreshHistory() {
  const items = await (window as any).uc.history.list();
  renderHistory(items);
}

function setConnectionStatus(text: string) {
  if (connectionStatusEl) {
    connectionStatusEl.textContent = text;
  }
}

async function initConnection() {
  // Load identity + ICE config from main process before connecting.
  const identity: Identity = await (window as any).uc.identity.get();
  const iceServers = await (window as any).uc.config.getIceServers();
  const wsUrl = (window as any).uc.config.wsUrl;

  let dataChannel: RTCDataChannel | null = null;
  let peerId: string | null = null;
  let peerConnection: RTCPeerConnection | null = null;

  const ws = new WebSocket(wsUrl);
  ws.onopen = () => {
    // Register this device for presence + signaling.
    ws.send(
      JSON.stringify({
        type: "hello",
        deviceId: identity.deviceId,
        deviceName: identity.deviceName,
        platform: identity.platform,
        publicKey: identity.publicKey,
      }),
    );
    setConnectionStatus("Connected to signaling server");
  };

  ws.onmessage = async (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "pair_created") {
      if (pairCodeEl) {
        pairCodeEl.textContent = `Code: ${message.code}`;
      }
      return;
    }

    if (message.type === "pair_paired") {
      const newPeerId = message.a === identity.deviceId ? message.b : message.a;
      peerId = newPeerId;
      const isInitiator = identity.deviceId < newPeerId;
      peerConnection = await ensurePeerConnection(isInitiator);
      return;
    }

    if (message.type === "signal") {
      const currentPeerId = peerId;
      if (!currentPeerId || message.from !== currentPeerId) {
        return;
      }
      if (!peerConnection) {
        peerConnection = await ensurePeerConnection(false);
      }
      await handleSignal(peerConnection, message.payload);
      return;
    }

    if (message.type === "error" && pairErrorEl) {
      pairErrorEl.textContent = message.message;
    }
  };

  function sendSignal(payload: SignalPayload) {
    if (!peerId) {
      return;
    }
    const signal: SignalMessage = {
      type: "signal",
      to: peerId,
      from: identity.deviceId,
      payload,
    };
    ws.send(JSON.stringify(signal));
  }

  function attachDataChannel(channel: RTCDataChannel) {
    // Wire DataChannel events to update UI + forward clip events to main.
    channel.onopen = () => {
      setConnectionStatus("DataChannel connected");
    };
    channel.onmessage = (evt) => {
      const clip = JSON.parse(evt.data) as ClipEventMessage;
      (window as any).uc.transport.sendToMain(clip);
    };
  }

  async function ensurePeerConnection(isInitiator: boolean) {
    if (peerConnection) {
      return peerConnection;
    }

    const pc = new RTCPeerConnection({ iceServers });
    pc.onicecandidate = (evt) => {
      if (evt.candidate) {
        sendSignal({ kind: "ice", data: evt.candidate });
      }
    };
    pc.ondatachannel = (evt) => {
      dataChannel = evt.channel;
      attachDataChannel(dataChannel);
    };

    if (isInitiator) {
      dataChannel = pc.createDataChannel("uc-data");
      attachDataChannel(dataChannel);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendSignal({ kind: "offer", data: offer });
    }

    return pc;
  }

  async function handleSignal(pc: RTCPeerConnection, payload: SignalPayload) {
    if (payload.kind === "offer") {
      await pc.setRemoteDescription(payload.data);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendSignal({ kind: "answer", data: answer });
      return;
    }

    if (payload.kind === "answer") {
      await pc.setRemoteDescription(payload.data);
      return;
    }

    if (payload.kind === "ice") {
      await pc.addIceCandidate(payload.data);
    }
  }

  (window as any).uc.transport.onSend((clip: ClipEventMessage) => {
    if (dataChannel && dataChannel.readyState === "open") {
      dataChannel.send(JSON.stringify(clip));
    }
  });

  if (pairCreateButton) {
    pairCreateButton.addEventListener("click", () => {
      ws.send(JSON.stringify({ type: "pair_create", deviceId: identity.deviceId }));
    });
  }

  if (pairJoinButton && pairJoinInput) {
    pairJoinButton.addEventListener("click", () => {
      const code = pairJoinInput.value.trim();
      ws.send(JSON.stringify({ type: "pair_join", deviceId: identity.deviceId, code }));
    });
  }
}

// Initial load + updates from main process.
refreshHistory();
(window as any).uc.history.onUpdated(() => {
  refreshHistory();
});

initConnection();

export {};
