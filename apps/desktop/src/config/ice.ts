import fs from "node:fs";
import path from "node:path";

export type IceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
  credentialType?: "password" | "oauth";
};

export type IceConfigFile = {
  iceServers: IceServer[];
  limits?: {
    maxTransferBytes?: number;
    chunkSizeBytes?: number;
  };
};

export type IceResolutionOptions = {
  env: NodeJS.ProcessEnv;
  userDataDir: string;
};

const DEFAULT_STUN: IceServer = {
  urls: ["stun:stun.l.google.com:19302"],
};

function parseCsv(value?: string) {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function readConfigFile(userDataDir: string): IceConfigFile | null {
  const configPath = path.join(userDataDir, "config.json");
  if (!fs.existsSync(configPath)) {
    return null;
  }

  const raw = fs.readFileSync(configPath, "utf8");
  return JSON.parse(raw) as IceConfigFile;
}

// Resolve ICE servers with the exact precedence defined in PLANS.md.
export function resolveIceServers({ env, userDataDir }: IceResolutionOptions): IceServer[] {
  if (env.UC_ICE_JSON) {
    const parsed = JSON.parse(env.UC_ICE_JSON) as IceServer[];
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  }

  const stunUrls = parseCsv(env.UC_STUN_URLS);
  const turnUrls = parseCsv(env.UC_TURN_URLS);
  if (stunUrls.length > 0 || turnUrls.length > 0) {
    const servers: IceServer[] = [];
    if (stunUrls.length > 0) {
      servers.push({ urls: stunUrls });
    }

    if (turnUrls.length > 0) {
      servers.push({
        urls: turnUrls,
        username: env.UC_TURN_USERNAME,
        credential: env.UC_TURN_CREDENTIAL,
        credentialType: env.UC_TURN_CREDENTIAL_TYPE as "password" | "oauth" | undefined,
      });
    }

    return servers;
  }

  const configFile = readConfigFile(userDataDir);
  if (configFile?.iceServers?.length) {
    return configFile.iceServers;
  }

  return [DEFAULT_STUN];
}
