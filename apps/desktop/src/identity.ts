import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export type IdentityRecord = {
  deviceId: string;
  createdAtMs: number;
};

const IDENTITY_FILE = "identity.json";

// Load or create the persistent device identity in the user data folder.
export function ensureIdentity(userDataDir: string): IdentityRecord {
  const identityPath = path.join(userDataDir, IDENTITY_FILE);

  if (fs.existsSync(identityPath)) {
    const raw = fs.readFileSync(identityPath, "utf8");
    return JSON.parse(raw) as IdentityRecord;
  }

  const identity: IdentityRecord = {
    deviceId: crypto.randomUUID().toLowerCase(),
    createdAtMs: Date.now(),
  };

  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(identityPath, JSON.stringify(identity, null, 2));
  return identity;
}
