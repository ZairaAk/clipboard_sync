import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import os from "node:os";

export type IdentityRecord = {
  deviceId: string;
  createdAtMs: number;
  publicKey: string;
  deviceName?: string;
};

const IDENTITY_FILE = "identity.json";

// Load or create the persistent device identity in the user data folder.
export function ensureIdentity(userDataDir: string): IdentityRecord {
  const identityPath = path.join(userDataDir, IDENTITY_FILE);

  if (fs.existsSync(identityPath)) {
    const raw = fs.readFileSync(identityPath, "utf8");
    const parsed = JSON.parse(raw) as IdentityRecord;
    let updated = false;

    if (!parsed.publicKey) {
      parsed.publicKey = crypto.randomBytes(32).toString("base64");
      updated = true;
    }
    // Ensure device name exists
    if (!parsed.deviceName) {
      parsed.deviceName = os.hostname();
      updated = true;
    }

    if (updated) {
      fs.writeFileSync(identityPath, JSON.stringify(parsed, null, 2));
    }
    return parsed;
  }

  const identity: IdentityRecord = {
    deviceId: crypto.randomUUID().toLowerCase(),
    createdAtMs: Date.now(),
    publicKey: crypto.randomBytes(32).toString("base64"),
    deviceName: os.hostname(),
  };

  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(identityPath, JSON.stringify(identity, null, 2));
  return identity;
}

export function updateIdentityName(userDataDir: string, name: string): IdentityRecord | null {
  const identityPath = path.join(userDataDir, IDENTITY_FILE);
  if (!fs.existsSync(identityPath)) return null;

  const raw = fs.readFileSync(identityPath, "utf8");
  const parsed = JSON.parse(raw) as IdentityRecord;
  parsed.deviceName = name;
  fs.writeFileSync(identityPath, JSON.stringify(parsed, null, 2));
  return parsed;
}
