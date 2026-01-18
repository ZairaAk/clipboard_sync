import fs from "node:fs";
import path from "node:path";

export type DeviceRecord = {
    deviceId: string;
    deviceName: string;
    platform: string;
    lastSeen: number;
    publicKey?: string;
    status?: string; // Add status tracking
    ignored?: boolean; // Add ignore flag
};

const DEVICES_FILE = "devices.json";

export class DeviceStore {
    private devices: Map<string, DeviceRecord> = new Map();
    private filePath: string;

    constructor(userDataDir: string) {
        this.filePath = path.join(userDataDir, DEVICES_FILE);
        console.log("[Main] DeviceStore initialized at:", this.filePath);
        this.load();
    }

    private load() {
        if (fs.existsSync(this.filePath)) {
            try {
                const raw = fs.readFileSync(this.filePath, "utf8");
                const list = JSON.parse(raw) as DeviceRecord[];
                list.forEach((d) => this.devices.set(d.deviceId, d));
                console.log(`[Main] Loaded ${list.length} devices`);
            } catch (err) {
                console.error("[Main] Failed to load devices.json:", err);
            }
        } else {
            console.log("[Main] No devices.json found, starting empty");
        }
    }

    private save() {
        try {
            const list = Array.from(this.devices.values());
            fs.writeFileSync(this.filePath, JSON.stringify(list, null, 2));
            console.log(`[Main] Saved ${list.length} devices to disk`);
        } catch (err) {
            console.error("[Main] Failed to save devices.json:", err);
        }
    }

    upsert(device: DeviceRecord) {
        this.devices.set(device.deviceId, device);
        this.save();
    }

    remove(deviceId: string) {
        console.log("[Main] Ignoring device:", deviceId);
        const device = this.devices.get(deviceId);
        if (device) {
            device.ignored = true;
            this.save();
        }
    }

    get(deviceId: string): DeviceRecord | undefined {
        const d = this.devices.get(deviceId);
        return d?.ignored ? undefined : d;
    }

    getAll(): DeviceRecord[] {
        return Array.from(this.devices.values()).filter(d => !d.ignored);
    }

    upsertMany(devices: Partial<DeviceRecord>[]) {
        let changed = false;
        devices.forEach((d) => {
            if (!d.deviceId) return;
            const existing = this.devices.get(d.deviceId);

            // If it's a new device, add it (unless we want to block new unknown ones? no)
            if (!existing) {
                this.devices.set(d.deviceId, d as DeviceRecord);
                changed = true;
                return;
            }

            // Update existing
            if (existing.lastSeen < (d.lastSeen || 0) || existing.deviceName !== d.deviceName || existing.status !== d.status) {
                // If it was ignored but is now ONLINE, un-ignore it?
                // For now, let's keep it ignored unless user re-adds (not possible via UI yet).
                // Or maybe un-ignore if status is 'online'?
                // Discussed plan: If it comes back online, we might want to see it.
                // But for "offline queue", we don't want zombies.
                // Zombies are "offline".

                // Merge updates
                Object.assign(existing, d);
                changed = true;
            }
        });
        if (changed) this.save();
    }
}
