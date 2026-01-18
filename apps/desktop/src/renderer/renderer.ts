// IIFE to avoid scope conflicts
(function () {
  // ============ Constants ============
  const DEFAULT_SERVER_URL = "wss://unscrutinizing-unspiritually-jaylen.ngrok-free.dev";

  // ============ Types ============
  type RtcConnectionState = "disconnected" | "connecting" | "connected" | "failed";

  interface HistoryItem {
    id: string;
    mime: string;
    contentHash: string;
    preview: string;
    sizeBytes: number;
    firstSeen: number;
    lastSeen: number;
    source: "local" | "remote";
    originDeviceId: string;
    contentText: string;
  }

  interface Identity {
    deviceId: string;
    deviceName: string;
    platform: string;
    publicKey: string;
  }

  interface UcApi {
    platform: string;
    getIdentity: () => Promise<Identity>;
    getHistory: () => Promise<HistoryItem[]>;
    getHistoryItem: (id: string) => Promise<HistoryItem | null>;
    deleteHistoryItem: (id: string) => Promise<{ success: boolean }>;
    onHistoryUpdated: (callback: () => void) => () => void;
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

  // ============ WebRTC Manager ============
  class WebRtcManager {
    private pc: RTCPeerConnection | null = null;
    private dataChannel: RTCDataChannel | null = null;
    private state: RtcConnectionState = "disconnected";
    private readonly selfId: string;
    private readonly peerId: string;
    private readonly iceServers: RTCIceServer[];
    private readonly sendSignal: (payload: { kind: string; data: unknown }) => void;
    private readonly onStateChange?: (state: RtcConnectionState) => void;
    private readonly onMessage?: (data: string) => void;
    private readonly isInitiator: boolean;

    constructor(config: {
      selfId: string;
      peerId: string;
      iceServers: RTCIceServer[];
      sendSignal: (payload: { kind: string; data: unknown }) => void;
      onStateChange?: (state: RtcConnectionState) => void;
      onMessage?: (data: string) => void;
    }) {
      this.selfId = config.selfId;
      this.peerId = config.peerId;
      this.iceServers = config.iceServers;
      this.sendSignal = config.sendSignal;
      this.onStateChange = config.onStateChange;
      this.onMessage = config.onMessage;
      this.isInitiator = config.selfId < config.peerId;
      console.log(`[WebRTC] Initialized - isInitiator: ${this.isInitiator}`);
    }

    async start(): Promise<void> {
      if (this.pc) return;
      this.setState("connecting");

      this.pc = new RTCPeerConnection({ iceServers: this.iceServers });

      this.pc.onicecandidate = (event) => {
        if (event.candidate) {
          this.sendSignal({ kind: "ice", data: event.candidate.toJSON() });
        }
      };

      this.pc.onconnectionstatechange = () => {
        if (this.pc?.connectionState === "failed") this.setState("failed");
        else if (this.pc?.connectionState === "disconnected") this.setState("disconnected");
      };

      this.pc.ondatachannel = (event) => {
        this.setupDataChannel(event.channel);
      };

      if (this.isInitiator) {
        const channel = this.pc.createDataChannel("clipboard-sync", { ordered: true });
        this.setupDataChannel(channel);
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        this.sendSignal({ kind: "offer", data: this.pc.localDescription?.toJSON() });
      }
    }

    async handleSignal(payload: { kind: string; data: unknown }): Promise<void> {
      if (!this.pc) await this.start();

      try {
        if (payload.kind === "offer") {
          await this.pc!.setRemoteDescription(payload.data as RTCSessionDescriptionInit);
          const answer = await this.pc!.createAnswer();
          await this.pc!.setLocalDescription(answer);
          this.sendSignal({ kind: "answer", data: this.pc!.localDescription?.toJSON() });
        } else if (payload.kind === "answer") {
          await this.pc!.setRemoteDescription(payload.data as RTCSessionDescriptionInit);
        } else if (payload.kind === "ice") {
          await this.pc!.addIceCandidate(payload.data as RTCIceCandidateInit);
        }
      } catch (err) {
        console.error("[WebRTC] Error handling signal:", err);
        this.setState("failed");
      }
    }

    send(data: string): boolean {
      if (!this.dataChannel || this.dataChannel.readyState !== "open") return false;
      this.dataChannel.send(data);
      return true;
    }

    getState(): RtcConnectionState {
      return this.state;
    }

    private setupDataChannel(channel: RTCDataChannel): void {
      this.dataChannel = channel;
      channel.onopen = () => this.setState("connected");
      channel.onclose = () => this.setState("disconnected");
      channel.onerror = () => this.setState("failed");
      channel.onmessage = (event) => this.onMessage?.(event.data);
    }

    private setState(state: RtcConnectionState): void {
      if (this.state !== state) {
        this.state = state;
        this.onStateChange?.(state);
      }
    }
  }

  // ============ Global State ============
  const uc = (window as any).uc as UcApi;
  let deviceId: string | null = null;
  let wsStatus: "disconnected" | "connecting" | "connected" = "disconnected";
  let webrtc: WebRtcManager | null = null;
  let currentPeerId: string | null = null;
  let currentPage = "devices";

  // Triple-click detection for ngrok page
  let versionClickCount = 0;
  let versionClickTimer: number | null = null;

  // ============ Utility Functions ============
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

  // ============ Navigation ============
  function navigateToPage(page: string): void {
    currentPage = page;

    document.querySelectorAll(".nav-item").forEach((item) => {
      item.classList.remove("active");
      if (item.getAttribute("data-page") === page) {
        item.classList.add("active");
      }
    });

    document.querySelectorAll(".page").forEach((p) => {
      p.classList.remove("active");
    });
    const pageEl = document.getElementById(`page-${page}`);
    if (pageEl) {
      pageEl.classList.add("active");
    }

    if (page === "history") {
      loadHistory();
    } else if (page === "devices") {
      updateDeviceList();
    }
  }

  (window as any).navigateToPage = navigateToPage;

  // ============ Connection Status UI ============
  function updateStatusUI(status: string): void {
    wsStatus = status as typeof wsStatus;

    // Update sidebar status
    const sidebarDot = document.getElementById("sidebarStatusDot");
    const sidebarText = document.getElementById("sidebarStatusText");

    if (sidebarDot) sidebarDot.className = `status-dot ${status}`;
    if (sidebarText) sidebarText.textContent = status.charAt(0).toUpperCase() + status.slice(1);

    // Update main connection status card
    const mainStatusDot = document.getElementById("mainStatusDot");
    const mainStatusText = document.getElementById("mainStatusText");
    const connectBtn = document.getElementById("connectBtn");
    const serverConnectSection = document.getElementById("serverConnectSection");
    const connectedInfoSection = document.getElementById("connectedInfoSection");
    const addDeviceBtn = document.getElementById("addDeviceBtn") as HTMLButtonElement;

    if (mainStatusDot) mainStatusDot.className = `status-dot ${status}`;
    if (mainStatusText) mainStatusText.textContent = status.charAt(0).toUpperCase() + status.slice(1);
    if (connectBtn) connectBtn.textContent = status === "connected" ? "Disconnect" : "Connect";

    // Toggle connect section visibility
    if (serverConnectSection && connectedInfoSection) {
      if (status === "connected") {
        serverConnectSection.classList.add("hidden");
        connectedInfoSection.classList.remove("hidden");
      } else {
        serverConnectSection.classList.remove("hidden");
        connectedInfoSection.classList.add("hidden");
      }
    }

    // Enable/disable add device button based on connection
    if (addDeviceBtn) {
      addDeviceBtn.disabled = status !== "connected";
    }

    updateAddDeviceSectionState();
  }

  function updateAddDeviceSectionState(): void {
    const addDeviceSection = document.getElementById("addDeviceSection");

    // If not connected, hide the add device section
    if (addDeviceSection && wsStatus !== "connected") {
      addDeviceSection.classList.add("hidden");
      resetPairingViews();
    }
  }

  function updateWebRtcStatus(state: RtcConnectionState): void {
    const rtcStatusText = document.getElementById("rtcStatusText");
    const pairingRtcStatus = document.getElementById("pairingRtcStatus");
    const connectedActions = document.getElementById("connectedActions");
    const webrtcStatusCard = document.getElementById("webrtcStatusCard");

    const statusLabel = state.charAt(0).toUpperCase() + state.slice(1);

    if (rtcStatusText) {
      rtcStatusText.textContent = statusLabel;
      rtcStatusText.className = `rtc-status ${state}`;
    }
    if (pairingRtcStatus) {
      pairingRtcStatus.textContent = statusLabel;
      pairingRtcStatus.className = `rtc-status ${state}`;
    }
    if (connectedActions) {
      connectedActions.classList.toggle("hidden", state !== "connected");
    }
    if (webrtcStatusCard) {
      webrtcStatusCard.style.display = currentPeerId ? "block" : "none";
    }

    // Update device list when WebRTC state changes
    updateDeviceList();
  }

  // ============ History ============
  let expandedHistoryId: string | null = null;

  async function loadHistory(): Promise<void> {
    const historyList = document.getElementById("historyList");
    if (!historyList) return;

    try {
      const items = await uc.getHistory();

      if (!items || items.length === 0) {
        historyList.innerHTML = `
          <div class="empty-state">
            <div class="icon">📋</div>
            <h3>No clipboard history</h3>
            <p>Copied items will appear here</p>
          </div>
        `;
        return;
      }

      historyList.innerHTML = items.map((item) => {
        const isExpanded = expandedHistoryId === item.id;
        const typeIcon = item.mime.startsWith("image/") ? "🖼️" : item.mime === "application/octet-stream" ? "📁" : "📝";
        const typeLabel = item.mime.startsWith("image/") ? "image" : item.mime === "application/octet-stream" ? "file" : "text";

        return `
        <div class="history-item ${isExpanded ? "expanded" : ""}" data-id="${item.id}">
          <div class="history-type-icon">${typeIcon}</div>
          <div class="history-content">
            <div class="history-preview">${escapeHtml(item.preview || "").slice(0, 100)}</div>
            <div class="history-full-content">${escapeHtml(item.contentText || item.preview || "")}</div>
            <div class="history-meta">${formatTime(item.lastSeen)} · ${typeLabel} · ${formatBytes(item.sizeBytes)}</div>
          </div>
          <div class="history-actions" onclick="event.stopPropagation()">
            <button class="small secondary copy-btn" data-id="${item.id}">Copy</button>
            <button class="small danger delete-btn" data-id="${item.id}">🗑️</button>
          </div>
        </div>
      `}).join("");

      // Add click handlers for expand/collapse
      historyList.querySelectorAll(".history-item").forEach((itemEl) => {
        itemEl.addEventListener("click", (e) => {
          const target = e.target as HTMLElement;
          // Don't toggle if clicking on a button
          if (target.closest(".history-actions")) return;

          const id = (itemEl as HTMLElement).getAttribute("data-id");
          if (id === expandedHistoryId) {
            expandedHistoryId = null;
            itemEl.classList.remove("expanded");
          } else {
            // Collapse any previously expanded item
            historyList.querySelectorAll(".history-item.expanded").forEach((el) => {
              el.classList.remove("expanded");
            });
            expandedHistoryId = id;
            itemEl.classList.add("expanded");
          }
        });
      });

      // Add copy button handlers
      historyList.querySelectorAll(".copy-btn").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const id = (e.target as HTMLElement).getAttribute("data-id");
          if (id) {
            const item = await uc.getHistoryItem(id);
            if (item && (item.contentText || item.preview)) {
              await navigator.clipboard.writeText(item.contentText || item.preview);
              (e.target as HTMLButtonElement).textContent = "Copied!";
              setTimeout(() => {
                (e.target as HTMLButtonElement).textContent = "Copy";
              }, 1500);
            }
          }
        });
      });

      // Add delete button handlers
      historyList.querySelectorAll(".delete-btn").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const id = (e.target as HTMLElement).getAttribute("data-id");
          if (id) {
            await uc.deleteHistoryItem(id);
            // History will refresh automatically via onHistoryUpdated
          }
        });
      });
    } catch (err) {
      console.error("[Renderer] Failed to load history:", err);
    }
  }

  function formatTime(ts: number): string {
    const date = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMs / 3600000);
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  }

  function formatBytes(bytes: number): string {
    if (!bytes) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function escapeHtml(str: string): string {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ============ Devices ============
  function updateDeviceList(): void {
    const deviceList = document.getElementById("deviceList");
    if (!deviceList) return;

    if (!currentPeerId) {
      deviceList.innerHTML = `
        <div class="empty-state">
          <div class="icon">📱</div>
          <h3>No devices paired</h3>
          <p>Pair with another device to start syncing clipboards</p>
        </div>
      `;
      return;
    }

    const rtcState = webrtc?.getState() || "disconnected";
    const isOnline = rtcState === "connected";

    deviceList.innerHTML = `
      <div class="device-item">
        <div class="device-info">
          <div class="device-avatar">💻</div>
          <div class="device-details">
            <h4>Device ${currentPeerId.slice(0, 8)}...</h4>
            <div class="device-meta">
              <span class="${isOnline ? "online-badge" : "offline-badge"}">
                ${isOnline ? "● Online" : "○ Offline"}
              </span>
              <span>WebRTC: ${rtcState}</span>
            </div>
          </div>
        </div>
        <div class="device-actions">
          <button class="small danger unpair-btn" data-peer-id="${currentPeerId}">Unpair</button>
        </div>
      </div>
    `;

    // Add unpair button handler
    const unpairBtn = deviceList.querySelector(".unpair-btn");
    if (unpairBtn) {
      unpairBtn.addEventListener("click", async () => {
        const confirmed = confirm("Are you sure you want to unpair this device? You will need to pair again to sync clipboards.");
        if (confirmed) {
          unpairDevice();
        }
      });
    }
  }

  function unpairDevice(notifyPeer = true): void {
    // Notify peer if we are initiating the unpair
    if (notifyPeer && webrtc) {
      try {
        webrtc.send(JSON.stringify({ type: "unpair" }));
      } catch (err) {
        console.error("[Renderer] Failed to send unpair notification:", err);
      }
    }

    // Close WebRTC connection if exists
    if (webrtc) {
      webrtc = null;
    }
    currentPeerId = null;
    updateWebRtcStatus("disconnected");
    updateDeviceList();

    // Show add device section so user can pair again
    const addDeviceSection = document.getElementById("addDeviceSection");
    if (addDeviceSection && wsStatus === "connected") {
      addDeviceSection.classList.remove("hidden");
      resetPairingViews();
    }
  }

  // ============ Pairing ============
  function showPairingError(message: string): void {
    const errorEl = document.getElementById("pairingError");
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.classList.remove("hidden");
    }
  }

  function hidePairingError(): void {
    const errorEl = document.getElementById("pairingError");
    if (errorEl) errorEl.classList.add("hidden");
  }

  function resetPairingViews(): void {
    document.getElementById("createCodeView")?.classList.add("hidden");
    document.getElementById("joinCodeView")?.classList.add("hidden");
    document.getElementById("pairingSuccess")?.classList.add("hidden");

    // Show the pairing options inline
    const pairingOptionsInline = document.getElementById("pairingOptionsInline");
    if (pairingOptionsInline) pairingOptionsInline.classList.remove("hidden");

    hidePairingError();
  }

  function handleDataChannelMessage(data: string): void {
    try {
      const msg = JSON.parse(data);
      const pingResult = document.getElementById("pingResult");

      if (msg.type === "ping") {
        webrtc?.send(JSON.stringify({ type: "pong", ts: Date.now() }));
        if (pingResult) pingResult.textContent = "Ping received!";
      } else if (msg.type === "pong") {
        if (pingResult) {
          pingResult.textContent = "Pong received! Connection works!";
          pingResult.style.color = "#4ade80";
        }
      } else if (msg.type === "clipboard") {
        console.log("[Renderer] Received clipboard data:", msg.data?.slice(0, 50));
      } else if (msg.type === "unpair") {
        console.log("[Renderer] Received unpair request from peer");
        unpairDevice(false); // Don't notify back to avoid loop
        alert("The other device has unpaired.");
      }
    } catch (err) {
      console.error("[Renderer] Failed to parse message:", err);
    }
  }

  // ============ Initialize ============
  async function init(): Promise<void> {
    deviceId = getOrCreateDeviceId();

    const deviceIdDisplay = document.getElementById("deviceIdDisplay");
    if (deviceIdDisplay) deviceIdDisplay.textContent = deviceId;

    // Navigation
    document.querySelectorAll(".nav-item").forEach((item) => {
      item.addEventListener("click", () => {
        const page = item.getAttribute("data-page");
        if (page) navigateToPage(page);
      });
    });

    // Version triple-click for ngrok page
    const versionText = document.getElementById("versionText");
    if (versionText) {
      versionText.addEventListener("click", () => {
        versionClickCount++;
        if (versionClickTimer) clearTimeout(versionClickTimer);
        versionClickTimer = window.setTimeout(() => { versionClickCount = 0; }, 500);
        if (versionClickCount >= 3) {
          versionClickCount = 0;
          navigateToPage("ngrok");
        }
      });
    }

    // Keyboard shortcut for ngrok page
    document.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === "N") {
        e.preventDefault();
        navigateToPage("ngrok");
      }
    });

    // Add Device button - show inline add device section
    const addDeviceBtn = document.getElementById("addDeviceBtn");
    const addDeviceSection = document.getElementById("addDeviceSection");
    if (addDeviceBtn && addDeviceSection) {
      addDeviceBtn.addEventListener("click", () => {
        if (wsStatus === "connected") {
          addDeviceSection.classList.remove("hidden");
          resetPairingViews();
        } else {
          alert("Please connect to server first");
        }
      });
    }

    // Cancel Add Device button
    const cancelAddDeviceBtn = document.getElementById("cancelAddDeviceBtn");
    if (cancelAddDeviceBtn && addDeviceSection) {
      cancelAddDeviceBtn.addEventListener("click", () => {
        addDeviceSection.classList.add("hidden");
        resetPairingViews();
      });
    }

    // Close pairing success button
    const closePairingSuccessBtn = document.getElementById("closePairingSuccessBtn");
    if (closePairingSuccessBtn && addDeviceSection) {
      closePairingSuccessBtn.addEventListener("click", () => {
        addDeviceSection.classList.add("hidden");
        resetPairingViews();
      });
    }

    // Connect button
    const connectBtn = document.getElementById("connectBtn");
    if (connectBtn) {
      connectBtn.addEventListener("click", async () => {
        if (wsStatus === "connected") {
          await uc.disconnect();
        } else {
          await uc.connect({ serverUrl: DEFAULT_SERVER_URL, deviceId: deviceId! });
        }
      });
    }

    // Pairing options
    const createPairOption = document.getElementById("createPairOption");
    const joinPairOption = document.getElementById("joinPairOption");
    const createCodeView = document.getElementById("createCodeView");
    const joinCodeView = document.getElementById("joinCodeView");
    const pairingOptionsInline = document.getElementById("pairingOptionsInline");

    if (createPairOption) {
      createPairOption.addEventListener("click", async () => {
        hidePairingError();
        const result = await uc.pairCreate();
        if (!result.success) {
          showPairingError(result.error || "Failed to create code");
          return;
        }
        if (pairingOptionsInline) pairingOptionsInline.classList.add("hidden");
        createCodeView?.classList.remove("hidden");
      });
    }

    if (joinPairOption) {
      joinPairOption.addEventListener("click", () => {
        hidePairingError();
        if (pairingOptionsInline) pairingOptionsInline.classList.add("hidden");
        joinCodeView?.classList.remove("hidden");
        (document.getElementById("joinCodeInput") as HTMLInputElement)?.focus();
      });
    }

    // Cancel buttons
    document.getElementById("cancelCreateBtn")?.addEventListener("click", resetPairingViews);
    document.getElementById("cancelJoinBtn")?.addEventListener("click", resetPairingViews);

    // Join code input
    const joinCodeInput = document.getElementById("joinCodeInput") as HTMLInputElement;
    const joinBtn = document.getElementById("joinBtn");

    if (joinCodeInput) {
      joinCodeInput.addEventListener("input", () => {
        joinCodeInput.value = joinCodeInput.value.replace(/\D/g, "").slice(0, 6);
      });
      joinCodeInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") joinBtn?.click();
      });
    }

    if (joinBtn) {
      joinBtn.addEventListener("click", async () => {
        const code = joinCodeInput?.value.trim();
        if (!code || !/^\d{6}$/.test(code)) {
          showPairingError("Please enter a 6-digit code");
          return;
        }
        hidePairingError();
        const result = await uc.pairJoin(code);
        if (!result.success) {
          showPairingError(result.error || "Failed to join");
        }
      });
    }

    // Send Ping button
    const sendPingBtn = document.getElementById("sendPingBtn");
    if (sendPingBtn) {
      sendPingBtn.addEventListener("click", () => {
        const pingResult = document.getElementById("pingResult");
        if (webrtc?.getState() === "connected") {
          webrtc.send(JSON.stringify({ type: "ping", ts: Date.now() }));
          if (pingResult) {
            pingResult.textContent = "Ping sent...";
            pingResult.style.color = "#64748b";
          }
        }
      });
    }

    // Settings toggles
    document.querySelectorAll(".toggle").forEach((toggle) => {
      toggle.addEventListener("click", () => toggle.classList.toggle("active"));
    });

    // Ngrok buttons
    const ngrokUrlInput = document.getElementById("ngrokUrlInput") as HTMLInputElement;
    const testNgrokBtn = document.getElementById("testNgrokBtn");
    const applyNgrokBtn = document.getElementById("applyNgrokBtn");
    const resetNgrokBtn = document.getElementById("resetNgrokBtn");
    const ngrokTestResult = document.getElementById("ngrokTestResult");

    if (applyNgrokBtn && ngrokUrlInput) {
      applyNgrokBtn.addEventListener("click", async () => {
        const url = ngrokUrlInput.value.trim();
        if (!url) {
          alert("Please enter a URL");
          return;
        }
        await uc.disconnect();
        await uc.connect({ serverUrl: url, deviceId: deviceId! });
        alert("Applied and reconnecting...");
      });
    }

    if (resetNgrokBtn && ngrokUrlInput) {
      resetNgrokBtn.addEventListener("click", () => {
        ngrokUrlInput.value = "";
        alert("Reset to default logic (uses hardcoded URL if not overridden)");
      });
    }

    // ============ IPC Event Listeners ============
    uc.onWsStatus(updateStatusUI);

    uc.onPairCreated((msg) => {
      const pairCodeDisplay = document.getElementById("pairCodeDisplay");
      if (pairCodeDisplay) pairCodeDisplay.textContent = msg.code;
    });

    uc.onPairPaired(async (msg) => {
      console.log("[Renderer] Paired with:", msg.peerId);
      currentPeerId = msg.peerId;

      // Hide pairing options and show success
      const pairingOptionsInline = document.getElementById("pairingOptionsInline");
      const pairingSuccess = document.getElementById("pairingSuccess");
      const pairedPeerIdText = document.getElementById("pairedPeerIdText");

      document.getElementById("createCodeView")?.classList.add("hidden");
      document.getElementById("joinCodeView")?.classList.add("hidden");
      if (pairingOptionsInline) pairingOptionsInline.classList.add("hidden");
      if (pairingSuccess) pairingSuccess.classList.remove("hidden");
      if (pairedPeerIdText) pairedPeerIdText.textContent = msg.peerId.slice(0, 8) + "...";

      updateWebRtcStatus("connecting");

      try {
        const iceServers = await uc.getIceServers();
        webrtc = new WebRtcManager({
          selfId: deviceId!,
          peerId: msg.peerId,
          iceServers,
          sendSignal: (payload) => uc.sendSignal(msg.peerId, payload),
          onStateChange: updateWebRtcStatus,
          onMessage: handleDataChannelMessage,
        });
        await webrtc.start();
      } catch (err) {
        console.error("[Renderer] WebRTC error:", err);
        updateWebRtcStatus("failed");
      }
    });

    uc.onError((msg) => showPairingError(msg.message));

    // Listen for history updates and auto-refresh
    uc.onHistoryUpdated(() => {
      console.log("[Renderer] History updated");
      if (currentPage === "history") {
        loadHistory();
      }
    });

    uc.onSignal(async (msg) => {
      if (!webrtc && currentPeerId === msg.from) {
        const iceServers = await uc.getIceServers();
        webrtc = new WebRtcManager({
          selfId: deviceId!,
          peerId: msg.from,
          iceServers,
          sendSignal: (payload) => uc.sendSignal(msg.from, payload),
          onStateChange: updateWebRtcStatus,
          onMessage: handleDataChannelMessage,
        });
      }
      if (webrtc) await webrtc.handleSignal(msg.payload);
    });

    // Load initial data
    loadHistory();
    updateDeviceList();

    // Auto-connect
    console.log("[Renderer] Auto-connecting to server...");
    await uc.connect({ serverUrl: DEFAULT_SERVER_URL, deviceId: deviceId! });

    console.log("[Renderer] Initialized with deviceId:", deviceId);
  }

  init();
})();
