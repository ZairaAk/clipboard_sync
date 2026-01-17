// Render a simple status message to confirm preload/renderer wiring.
const statusEl = document.getElementById("status");
const platform = (window as any).uc?.platform ?? "unknown";
if (statusEl) {
  statusEl.textContent = `Desktop app ready on ${platform}.`;
}

export {};
