import path from "node:path";
import crypto from "node:crypto";
import sqlite3 from "sqlite3";
import { nativeImage } from "electron";

export type HistorySource = "local" | "remote";

export type HistoryItem = {
  id: string;
  mime: string;
  contentHash: string;
  preview: string;
  sizeBytes: number;
  firstSeen: number;
  lastSeen: number;
  source: HistorySource;
  originDeviceId: string;
  contentText: string;
  contentBlob: Buffer | null;
  thumbnailBlob: Buffer | null;
};

// Thumbnail max dimension (100x100)
const THUMBNAIL_MAX_SIZE = 100;

const HISTORY_MAX_ITEMS = 200;
const DB_FILE_NAME = "history.sqlite";

// SQLite-backed history store for clipboard items.
export class HistoryStore {
  private db: sqlite3.Database;

  constructor(userDataDir: string) {
    const dbPath = path.join(userDataDir, DB_FILE_NAME);
    this.db = new sqlite3.Database(dbPath);
    this.migrate();
  }

  private migrate() {
    this.db.serialize(() => {
      this.db.run(
        `CREATE TABLE IF NOT EXISTS history_items (
          id TEXT PRIMARY KEY,
          mime TEXT NOT NULL,
          contentHash TEXT NOT NULL,
          preview TEXT NOT NULL,
          sizeBytes INTEGER NOT NULL,
          firstSeen INTEGER NOT NULL,
          lastSeen INTEGER NOT NULL,
          source TEXT NOT NULL,
          originDeviceId TEXT NOT NULL,
          contentText TEXT NOT NULL
        );`,
      );
      this.db.run(
        "CREATE INDEX IF NOT EXISTS idx_history_dedupe ON history_items (mime, contentHash);",
      );
      this.db.run(
        "CREATE INDEX IF NOT EXISTS idx_history_last_seen ON history_items (lastSeen DESC);",
      );

      // Migration: Add BLOB columns for image storage
      this.db.run(
        "ALTER TABLE history_items ADD COLUMN contentBlob BLOB;",
        () => {}, // Ignore error if column exists
      );
      this.db.run(
        "ALTER TABLE history_items ADD COLUMN thumbnailBlob BLOB;",
        () => {}, // Ignore error if column exists
      );
    });
  }

  async upsertText(params: {
    text: string;
    source: HistorySource;
    originDeviceId: string;
  }): Promise<HistoryItem> {
    const now = Date.now();
    const mime = "text/plain";
    const contentHash = this.hashText(params.text);
    const preview = this.makePreview(params.text);
    const sizeBytes = Buffer.byteLength(params.text, "utf8");

    const existing = await this.getByDedupeKey(mime, contentHash);
    if (existing) {
      await this.run(
        `UPDATE history_items
         SET lastSeen = ?, preview = ?, sizeBytes = ?, source = ?, originDeviceId = ?, contentText = ?
         WHERE id = ?`,
        [now, preview, sizeBytes, params.source, params.originDeviceId, params.text, existing.id],
      );

      await this.enforceMaxItems();
      return { ...existing, lastSeen: now, preview, sizeBytes, source: params.source, originDeviceId: params.originDeviceId, contentText: params.text, contentBlob: null, thumbnailBlob: null };
    }

    const id = crypto.randomUUID();
    const item: HistoryItem = {
      id,
      mime,
      contentHash,
      preview,
      sizeBytes,
      firstSeen: now,
      lastSeen: now,
      source: params.source,
      originDeviceId: params.originDeviceId,
      contentText: params.text,
      contentBlob: null,
      thumbnailBlob: null,
    };

    await this.run(
      `INSERT INTO history_items
       (id, mime, contentHash, preview, sizeBytes, firstSeen, lastSeen, source, originDeviceId, contentText)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item.id,
        item.mime,
        item.contentHash,
        item.preview,
        item.sizeBytes,
        item.firstSeen,
        item.lastSeen,
        item.source,
        item.originDeviceId,
        item.contentText,
      ],
    );

    await this.enforceMaxItems();
    return item;
  }

  async upsertImage(params: {
    buffer: Buffer;
    mime: string;
    source: HistorySource;
    originDeviceId: string;
  }): Promise<HistoryItem> {
    const now = Date.now();
    const contentHash = this.hashBuffer(params.buffer);
    const sizeBytes = params.buffer.length;

    // Generate thumbnail
    const thumbnail = this.generateThumbnail(params.buffer);
    const preview = `Image (${this.formatBytes(sizeBytes)})`;

    const existing = await this.getByDedupeKey(params.mime, contentHash);
    if (existing) {
      await this.run(
        `UPDATE history_items
         SET lastSeen = ?, preview = ?, sizeBytes = ?, source = ?, originDeviceId = ?,
             contentBlob = ?, thumbnailBlob = ?
         WHERE id = ?`,
        [now, preview, sizeBytes, params.source, params.originDeviceId,
         params.buffer, thumbnail, existing.id],
      );

      await this.enforceMaxItems();
      return {
        ...existing,
        lastSeen: now,
        preview,
        sizeBytes,
        source: params.source,
        originDeviceId: params.originDeviceId,
        contentBlob: params.buffer,
        thumbnailBlob: thumbnail,
      };
    }

    const id = crypto.randomUUID();
    const item: HistoryItem = {
      id,
      mime: params.mime,
      contentHash,
      preview,
      sizeBytes,
      firstSeen: now,
      lastSeen: now,
      source: params.source,
      originDeviceId: params.originDeviceId,
      contentText: "",
      contentBlob: params.buffer,
      thumbnailBlob: thumbnail,
    };

    await this.run(
      `INSERT INTO history_items
       (id, mime, contentHash, preview, sizeBytes, firstSeen, lastSeen, source, originDeviceId, contentText, contentBlob, thumbnailBlob)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item.id,
        item.mime,
        item.contentHash,
        item.preview,
        item.sizeBytes,
        item.firstSeen,
        item.lastSeen,
        item.source,
        item.originDeviceId,
        item.contentText,
        item.contentBlob,
        item.thumbnailBlob,
      ],
    );

    await this.enforceMaxItems();
    return item;
  }

  async getBlob(id: string): Promise<{ contentBlob: Buffer | null; thumbnailBlob: Buffer | null; mime: string } | null> {
    const row = await this.get<{ contentBlob: Buffer | null; thumbnailBlob: Buffer | null; mime: string }>(
      "SELECT contentBlob, thumbnailBlob, mime FROM history_items WHERE id = ?",
      [id],
    );
    return row ?? null;
  }

  async list(limit = HISTORY_MAX_ITEMS): Promise<HistoryItem[]> {
    const rows = await this.all<HistoryItem>(
      `SELECT * FROM history_items
       ORDER BY lastSeen DESC
       LIMIT ?`,
      [limit],
    );
    return rows;
  }

  async getById(id: string): Promise<HistoryItem | null> {
    const row = await this.get<HistoryItem>(
      "SELECT * FROM history_items WHERE id = ?",
      [id],
    );
    return row ?? null;
  }

  async deleteById(id: string): Promise<boolean> {
    await this.run("DELETE FROM history_items WHERE id = ?", [id]);
    return true;
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.close((err) => (err ? reject(err) : resolve()));
    });
  }

  private async getByDedupeKey(mime: string, contentHash: string) {
    return this.get<HistoryItem>(
      "SELECT * FROM history_items WHERE mime = ? AND contentHash = ?",
      [mime, contentHash],
    );
  }

  private async enforceMaxItems() {
    const row = await this.get<{ count: number }>(
      "SELECT COUNT(*) as count FROM history_items",
    );
    if (!row || row.count <= HISTORY_MAX_ITEMS) {
      return;
    }

    const excess = row.count - HISTORY_MAX_ITEMS;
    await this.run(
      `DELETE FROM history_items
       WHERE id IN (
         SELECT id FROM history_items
         ORDER BY lastSeen ASC
         LIMIT ?
       )`,
      [excess],
    );
  }

  private run(sql: string, params: unknown[] = []) {
    return new Promise<void>((resolve, reject) => {
      this.db.run(sql, params, (err) => (err ? reject(err) : resolve()));
    });
  }

  private get<T>(sql: string, params: unknown[] = []) {
    return new Promise<T | undefined>((resolve, reject) => {
      this.db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row as T)));
    });
  }

  private all<T>(sql: string, params: unknown[] = []) {
    return new Promise<T[]>((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows as T[])));
    });
  }

  private hashText(text: string) {
    return crypto.createHash("sha256").update(text, "utf8").digest("hex");
  }

  private hashBuffer(buffer: Buffer) {
    return crypto.createHash("sha256").update(buffer).digest("hex");
  }

  private makePreview(text: string) {
    const trimmed = text.replace(/\s+/g, " ").trim();
    return trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed;
  }

  private generateThumbnail(buffer: Buffer): Buffer | null {
    try {
      const image = nativeImage.createFromBuffer(buffer);
      if (image.isEmpty()) {
        return null;
      }

      const size = image.getSize();
      if (size.width <= THUMBNAIL_MAX_SIZE && size.height <= THUMBNAIL_MAX_SIZE) {
        // Image is small enough, use as-is
        return buffer;
      }

      // Calculate new dimensions maintaining aspect ratio
      const scale = Math.min(
        THUMBNAIL_MAX_SIZE / size.width,
        THUMBNAIL_MAX_SIZE / size.height,
      );
      const newWidth = Math.round(size.width * scale);
      const newHeight = Math.round(size.height * scale);

      const resized = image.resize({ width: newWidth, height: newHeight });
      return resized.toPNG();
    } catch (err) {
      console.error("[HistoryStore] Failed to generate thumbnail:", err);
      return null;
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
