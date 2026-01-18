import fs from "node:fs";
import path from "node:path";
import sqlite3 from "sqlite3";

export type DeviceRecord = {
    deviceId: string;
    deviceName: string;
    platform: string;
    lastSeen: number;
    publicKey?: string;
    status?: string;
};

// Legacy file for migration
const DEVICES_JSON_FILE = "devices.json";
const DB_FILE_NAME = "devices.sqlite";

export class DeviceStore {
    private db: sqlite3.Database;
    private legacyPath: string;

    constructor(userDataDir: string) {
        const dbPath = path.join(userDataDir, DB_FILE_NAME);
        this.legacyPath = path.join(userDataDir, DEVICES_JSON_FILE);
        console.log("[Main] DeviceStore (SQLite) initialized at:", dbPath);

        this.db = new sqlite3.Database(dbPath);
        this.init();
    }

    private init() {
        this.db.serialize(() => {
            this.db.run(`
                CREATE TABLE IF NOT EXISTS devices (
                    deviceId TEXT PRIMARY KEY,
                    deviceName TEXT NOT NULL,
                    platform TEXT NOT NULL,
                    lastSeen INTEGER NOT NULL,
                    publicKey TEXT,
                    status TEXT
                )
            `);

            // Attempt migration
            this.migrateFromJSON();
        });
    }

    private migrateFromJSON() {
        if (fs.existsSync(this.legacyPath)) {
            try {
                console.log("[Main] Migrating devices.json to SQLite...");
                const raw = fs.readFileSync(this.legacyPath, "utf8");
                const list = JSON.parse(raw) as DeviceRecord[];

                const stmt = this.db.prepare("INSERT OR REPLACE INTO devices (deviceId, deviceName, platform, lastSeen, publicKey, status) VALUES (?, ?, ?, ?, ?, ?)");
                list.forEach(d => {
                    // Filter out ignored if they were persisted? User wants clean start so maybe just import all.
                    // The JSON usually didn't have 'ignored' unless from my last edit. 
                    // If it has 'ignored', we skip it.
                    if ((d as any).ignored) return;

                    stmt.run(d.deviceId, d.deviceName, d.platform, d.lastSeen, d.publicKey, d.status || "offline");
                });
                stmt.finalize();

                console.log(`[Main] Migrated ${list.length} devices.`);
                // Rename legacy file to avoid re-migration
                fs.renameSync(this.legacyPath, this.legacyPath + ".bak");
            } catch (err) {
                console.error("[Main] Migration failed:", err);
            }
        }
    }

    async upsert(device: DeviceRecord): Promise<void> {
        return this.run(
            "INSERT OR REPLACE INTO devices (deviceId, deviceName, platform, lastSeen, publicKey, status) VALUES (?, ?, ?, ?, ?, ?)",
            [device.deviceId, device.deviceName, device.platform, device.lastSeen, device.publicKey, device.status]
        );
    }

    async remove(deviceId: string): Promise<void> {
        console.log("[Main] Deleting device from DB:", deviceId);
        await this.run("DELETE FROM devices WHERE deviceId = ?", [deviceId]);
    }

    async get(deviceId: string): Promise<DeviceRecord | undefined> {
        return this.getOne<DeviceRecord>("SELECT * FROM devices WHERE deviceId = ?", [deviceId]);
    }

    async getAll(): Promise<DeviceRecord[]> {
        return this.all<DeviceRecord>("SELECT * FROM devices ORDER BY lastSeen DESC");
    }

    async upsertMany(devices: Partial<DeviceRecord>[]) {
        // Transaction for performance
        this.db.serialize(() => {
            this.db.run("BEGIN TRANSACTION");
            const stmt = this.db.prepare(`
                INSERT INTO devices (deviceId, deviceName, platform, lastSeen, publicKey, status) 
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(deviceId) DO UPDATE SET
                    lastSeen = excluded.lastSeen,
                    deviceName = excluded.deviceName,
                    status = excluded.status
            `);

            devices.forEach(d => {
                if (!d.deviceId) return;
                // We need to fetch existing if partial? "ON CONFLICT UPDATE" handles updates.
                // But we need to ensure all fields are present for INSERT.
                // Since this is upsertMany from Server, it might be partial.
                // We should check if it exists first?
                // Actually, the server usually sends FULL records for "hello" or "list".
                // But if it sends partial, SQLite NOT NULL constraints will fail on INSERT.
                // However, the protocol schema ensures deviceId, deviceName, platform are present in 'DeviceInfo'.
                // So it should be fine.

                if (d.deviceName && d.platform) {
                    stmt.run(d.deviceId, d.deviceName, d.platform, d.lastSeen || Date.now(), d.publicKey, d.status || "online");
                } else {
                    // It's a partial update? e.g. status only?
                    // We can run a specific UPDATE.
                    if (d.status) {
                        this.db.run("UPDATE devices SET status = ? WHERE deviceId = ?", [d.status, d.deviceId]);
                    }
                }
            });

            stmt.finalize();
            this.db.run("COMMIT");
        });
    }

    async setOffline(exceptDeviceIds: string[] = []) {
        // Set all non-active devices to offline?
        // Actually, since server sends full list of ACTIVE devices, we can mark everyone else as offline.
        // Assuming upsertMany updates the active ones.
        if (exceptDeviceIds.length === 0) {
            await this.run("UPDATE devices SET status = 'offline'");
        } else {
            const placeholders = exceptDeviceIds.map(() => "?").join(",");
            await this.run(`UPDATE devices SET status = 'offline' WHERE deviceId NOT IN (${placeholders})`, exceptDeviceIds);
        }
    }

    // Helper wrappers
    private run(sql: string, params: unknown[] = []) {
        return new Promise<void>((resolve, reject) => {
            this.db.run(sql, params, (err) => (err ? reject(err) : resolve()));
        });
    }

    private getOne<T>(sql: string, params: unknown[] = []) {
        return new Promise<T | undefined>((resolve, reject) => {
            this.db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row as T)));
        });
    }

    private all<T>(sql: string, params: unknown[] = []) {
        return new Promise<T[]>((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows as T[])));
        });
    }
}
