import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { generate } from "selfsigned";
import acme from "acme-client";

export type TlsMode = "selfsigned" | "letsencrypt" | "custom";

export interface TlsFiles {
  cert: string;
  key: string;
}

export interface TlsOptions {
  mode: TlsMode;
  dataDir: string;
  domain?: string;
  email?: string;
  certPath?: string;
  keyPath?: string;
  announcedIp?: string;
}

/**
 * Get TLS certificate and key based on the configured mode.
 *
 * Modes:
 * - "selfsigned" (default): Auto-generate a self-signed cert, persisted in dataDir
 * - "letsencrypt": Obtain a cert from Let's Encrypt via ACME HTTP-01 challenge
 * - "custom": Use user-provided cert/key PEM files
 */
export async function getTlsConfig(opts: TlsOptions): Promise<TlsFiles> {
  mkdirSync(opts.dataDir, { recursive: true });

  switch (opts.mode) {
    case "custom":
      return getCustomCert(opts);
    case "letsencrypt":
      return getLetsEncryptCert(opts);
    case "selfsigned":
    default:
      return getSelfSignedCert(opts);
  }
}

// ── Custom (user-provided) ───────────────────────────────────────────────────

function getCustomCert(opts: TlsOptions): TlsFiles {
  const certPath = resolve(opts.certPath ?? "");
  const keyPath = resolve(opts.keyPath ?? "");
  if (!certPath || !keyPath) throw new Error("[tls] custom mode requires RADDIR_TLS_CERT and RADDIR_TLS_KEY");
  if (!existsSync(certPath)) throw new Error(`[tls] cert not found: ${certPath}`);
  if (!existsSync(keyPath)) throw new Error(`[tls] key not found: ${keyPath}`);
  console.log("[tls] Using user-provided TLS certificate");
  return {
    cert: readFileSync(certPath, "utf-8"),
    key: readFileSync(keyPath, "utf-8"),
  };
}

// ── Self-signed ──────────────────────────────────────────────────────────────

async function getSelfSignedCert(opts: TlsOptions): Promise<TlsFiles> {
  const certPath = resolve(opts.dataDir, "tls-cert.pem");
  const keyPath = resolve(opts.dataDir, "tls-key.pem");

  if (existsSync(certPath) && existsSync(keyPath)) {
    console.log("[tls] Using existing self-signed certificate");
    return {
      cert: readFileSync(certPath, "utf-8"),
      key: readFileSync(keyPath, "utf-8"),
    };
  }

  console.log("[tls] Generating self-signed certificate...");

  // Build SANs: always include localhost defaults, plus configured domain/IP
  const altNames: Array<{ type: 2; value: string } | { type: 7; ip: string }> = [
    { type: 2, value: "localhost" },
    { type: 7, ip: "127.0.0.1" },
    { type: 7, ip: "::1" },
  ];

  if (opts.domain) {
    altNames.push({ type: 2, value: opts.domain });
  }

  if (opts.announcedIp && opts.announcedIp !== "127.0.0.1") {
    // Check if it looks like an IP address or a hostname
    if (/^[\d.]+$/.test(opts.announcedIp) || opts.announcedIp.includes(":")) {
      altNames.push({ type: 7, ip: opts.announcedIp });
    } else {
      altNames.push({ type: 2, value: opts.announcedIp });
    }
  }

  const now = new Date();
  const expiry = new Date(now);
  expiry.setFullYear(expiry.getFullYear() + 10);

  const pems = await generate([{ name: "commonName", value: "Raddir Server" }], {
    keySize: 2048,
    algorithm: "sha256",
    notBeforeDate: now,
    notAfterDate: expiry,
    extensions: [
      { name: "basicConstraints", cA: false },
      { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
      { name: "extKeyUsage", serverAuth: true },
      { name: "subjectAltName", altNames },
    ],
  });

  writeFileSync(certPath, pems.cert, "utf-8");
  writeFileSync(keyPath, pems.private, "utf-8");
  console.log(`[tls] Self-signed certificate generated with SANs: ${altNames.map(a => "value" in a ? a.value : a.ip).join(", ")}`);

  return { cert: pems.cert, key: pems.private };
}

// ── Let's Encrypt ────────────────────────────────────────────────────────────

async function getLetsEncryptCert(opts: TlsOptions): Promise<TlsFiles> {
  if (!opts.domain) throw new Error("[tls] letsencrypt mode requires RADDIR_TLS_DOMAIN");
  if (!opts.email) throw new Error("[tls] letsencrypt mode requires RADDIR_TLS_EMAIL");

  const certPath = resolve(opts.dataDir, "le-cert.pem");
  const keyPath = resolve(opts.dataDir, "le-key.pem");
  const accountKeyPath = resolve(opts.dataDir, "le-account-key.pem");

  // Check for existing valid cert
  if (existsSync(certPath) && existsSync(keyPath)) {
    const cert = readFileSync(certPath, "utf-8");
    const key = readFileSync(keyPath, "utf-8");

    try {
      const info = acme.crypto.readCertificateInfo(cert);
      const daysLeft = (info.notAfter.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      if (daysLeft > 30) {
        console.log(`[tls] Using existing Let's Encrypt certificate (${Math.floor(daysLeft)} days remaining)`);
        return { cert, key };
      }
      console.log(`[tls] Let's Encrypt certificate expires in ${Math.floor(daysLeft)} days, renewing...`);
    } catch {
      console.log("[tls] Existing Let's Encrypt certificate is invalid, requesting new one...");
    }
  }

  console.log(`[tls] Requesting Let's Encrypt certificate for ${opts.domain}...`);

  // Get or create account key
  let accountKey: Buffer;
  if (existsSync(accountKeyPath)) {
    accountKey = Buffer.from(readFileSync(accountKeyPath, "utf-8"));
  } else {
    accountKey = await acme.crypto.createPrivateKey();
    writeFileSync(accountKeyPath, accountKey.toString(), "utf-8");
  }

  // Create ACME client
  const client = new acme.Client({
    directoryUrl: acme.directory.letsencrypt.production,
    accountKey,
  });

  // Create CSR
  const [serverKey, csr] = await acme.crypto.createCsr({
    commonName: opts.domain,
    altNames: [opts.domain],
  });

  // HTTP-01 challenge tokens served via a temporary HTTP server on port 80
  const challengeTokens = new Map<string, string>();

  const challengeServer = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    const prefix = "/.well-known/acme-challenge/";
    if (req.url?.startsWith(prefix)) {
      const token = req.url.slice(prefix.length);
      const keyAuth = challengeTokens.get(token);
      if (keyAuth) {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(keyAuth);
        return;
      }
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve, reject) => {
    challengeServer.listen(80, "0.0.0.0", () => {
      console.log("[tls] ACME challenge server listening on port 80");
      resolve();
    });
    challengeServer.on("error", (err: Error) => {
      reject(new Error(`[tls] Failed to start ACME challenge server on port 80: ${err.message}. Make sure port 80 is available.`));
    });
  });

  try {
    const cert = await client.auto({
      csr,
      email: opts.email,
      termsOfServiceAgreed: true,
      challengeCreateFn: async (_authz, challenge, keyAuthorization) => {
        challengeTokens.set(challenge.token, keyAuthorization);
      },
      challengeRemoveFn: async (_authz, challenge) => {
        challengeTokens.delete(challenge.token);
      },
      challengePriority: ["http-01"],
    });

    // Save cert and key
    writeFileSync(certPath, cert, "utf-8");
    writeFileSync(keyPath, serverKey.toString(), "utf-8");
    console.log("[tls] Let's Encrypt certificate obtained and saved");

    return { cert, key: serverKey.toString() };
  } finally {
    // Always shut down the challenge server
    await new Promise<void>((resolve) => challengeServer.close(() => resolve()));
    console.log("[tls] ACME challenge server stopped");
  }
}

/**
 * Schedule automatic certificate renewal for Let's Encrypt.
 * Checks daily and renews if the cert expires within 30 days.
 */
export function scheduleRenewal(opts: TlsOptions, onRenewed: (tls: TlsFiles) => void): void {
  if (opts.mode !== "letsencrypt") return;

  const TWELVE_HOURS = 12 * 60 * 60 * 1000;
  setInterval(async () => {
    try {
      const certPath = resolve(opts.dataDir, "le-cert.pem");
      if (!existsSync(certPath)) return;

      const cert = readFileSync(certPath, "utf-8");
      const info = acme.crypto.readCertificateInfo(cert);
      const daysLeft = (info.notAfter.getTime() - Date.now()) / (1000 * 60 * 60 * 24);

      if (daysLeft <= 30) {
        console.log(`[tls] Certificate expires in ${Math.floor(daysLeft)} days, auto-renewing...`);
        const newTls = await getLetsEncryptCert(opts);
        onRenewed(newTls);
      }
    } catch (err) {
      console.error("[tls] Auto-renewal check failed:", err);
    }
  }, TWELVE_HOURS);
}
