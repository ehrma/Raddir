import { config as loadEnv } from "dotenv";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { availableParallelism } from "node:os";

// Try loading .env from cwd, then monorepo root (../../ from packages/server)
loadEnv();
loadEnv({ path: resolve(process.cwd(), "../../.env"), override: false });

export interface RaddirConfig {
  host: string;
  port: number;
  rtcMinPort: number;
  rtcMaxPort: number;
  announcedIp: string;
  dbPath: string;
  adminToken: string;
  password: string;
  logLevel: string;
  mediaWorkers: number;
  tlsMode: string;
  tlsCert: string;
  tlsKey: string;
  tlsDomain: string;
  tlsEmail: string;
  openAdmin: boolean;
  trustProxy: boolean;
}

function loadConfigFile(): Partial<RaddirConfig> {
  const configPath = resolve(process.env.RADDIR_CONFIG_PATH ?? "./raddir.config.json");
  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, "utf-8");
      return JSON.parse(raw) as Partial<RaddirConfig>;
    } catch {
      console.warn(`[config] Failed to parse config file at ${configPath}, using defaults`);
    }
  }
  return {};
}

export function loadConfig(): RaddirConfig {
  const file = loadConfigFile();
  const cpus = availableParallelism();

  return {
    host: process.env.RADDIR_HOST ?? file.host ?? "0.0.0.0",
    port: parseInt(process.env.RADDIR_PORT ?? "", 10) || (file.port ?? 4000),
    rtcMinPort: parseInt(process.env.RADDIR_RTC_MIN_PORT ?? "", 10) || (file.rtcMinPort ?? 40000),
    rtcMaxPort: parseInt(process.env.RADDIR_RTC_MAX_PORT ?? "", 10) || (file.rtcMaxPort ?? 49999),
    announcedIp: process.env.RADDIR_ANNOUNCED_IP ?? file.announcedIp ?? "",
    dbPath: process.env.RADDIR_DB_PATH ?? file.dbPath ?? "./data/raddir.db",
    adminToken: process.env.RADDIR_ADMIN_TOKEN ?? file.adminToken ?? "",
    password: process.env.RADDIR_PASSWORD ?? file.password ?? "",
    logLevel: process.env.RADDIR_LOG_LEVEL ?? file.logLevel ?? "info",
    mediaWorkers: parseInt(process.env.RADDIR_MEDIA_WORKERS ?? "", 10) || (file.mediaWorkers ?? cpus),
    tlsMode: process.env.RADDIR_TLS_MODE ?? file.tlsMode ?? "selfsigned",
    tlsCert: process.env.RADDIR_TLS_CERT ?? file.tlsCert ?? "",
    tlsKey: process.env.RADDIR_TLS_KEY ?? file.tlsKey ?? "",
    tlsDomain: process.env.RADDIR_TLS_DOMAIN ?? file.tlsDomain ?? "",
    tlsEmail: process.env.RADDIR_TLS_EMAIL ?? file.tlsEmail ?? "",
    openAdmin: (process.env.RADDIR_OPEN_ADMIN ?? "").toLowerCase() === "true" || (file.openAdmin ?? false),
    trustProxy: (process.env.RADDIR_TRUST_PROXY ?? "").toLowerCase() === "true" || (file.trustProxy ?? false),
  };
}
