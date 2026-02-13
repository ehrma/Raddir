import { app, BrowserWindow, globalShortcut, ipcMain, nativeTheme, Tray, Menu, nativeImage, safeStorage, session } from "electron";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { generateKeyPairSync, createSign, createPrivateKey } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let trustedServerHost: string | null = null;

function getTrayIconPath(): string {
  if (process.env.VITE_DEV_SERVER_URL) {
    return join(__dirname, "../public/raddir-tray-icon.png");
  }
  return join(__dirname, "../dist/raddir-tray-icon.png");
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "Raddir",
    icon: getTrayIconPath(),
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, "../dist/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// Accept self-signed TLS certificates only for the configured Raddir server
app.on("certificate-error", (event, _webContents, url, _error, _certificate, callback) => {
  try {
    const parsed = new URL(url);
    if (trustedServerHost && parsed.host === trustedServerHost) {
      event.preventDefault();
      callback(true);
      return;
    }
  } catch {}
  callback(false);
});

app.whenReady().then(() => {
  createWindow();

  // System tray — write to temp file to avoid Windows icon cache issues
  const trayImage = nativeImage.createFromPath(getTrayIconPath());
  const tempTrayPath = join(app.getPath("temp"), `raddir-tray-${Date.now()}.png`);
  writeFileSync(tempTrayPath, trayImage.toPNG());
  tray = new Tray(tempTrayPath);
  tray.setToolTip("Raddir");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Show Raddir", click: () => mainWindow?.show() },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]));
  tray.on("click", () => mainWindow?.show());

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

// IPC: Push-to-talk global shortcut registration
ipcMain.handle("register-ptt-key", (_event, key: string) => {
  globalShortcut.unregisterAll();

  if (!key) return;

  globalShortcut.register(key, () => {
    mainWindow?.webContents.send("ptt-pressed");
  });

  // There's no "key up" event for globalShortcut, so we use a polling approach
  // The renderer will handle PTT state via keydown/keyup for focused window
  // and globalShortcut for unfocused window
});

ipcMain.handle("unregister-ptt-key", () => {
  globalShortcut.unregisterAll();
});

// IPC: Register the Raddir server host to trust its self-signed certificate
ipcMain.handle("trust-server-host", (_event, host: string) => {
  trustedServerHost = host || null;

  // Also bypass certificate verification at the session level so that
  // fetch() calls from the renderer trust the self-signed cert.
  if (trustedServerHost) {
    const trustedHostname = trustedServerHost.split(":")[0];
    session.defaultSession.setCertificateVerifyProc((request, callback) => {
      if (request.hostname === trustedHostname) {
        callback(0); // 0 = success / trust
        return;
      }
      callback(-3); // -3 = use default verification
    });
  } else {
    session.defaultSession.setCertificateVerifyProc(null);
  }
});

// IPC: Encrypt/decrypt strings using OS-level encryption (Electron safeStorage)
ipcMain.handle("safe-storage-encrypt", (_event, plaintext: string) => {
  if (!safeStorage.isEncryptionAvailable()) return null;
  return safeStorage.encryptString(plaintext).toString("base64");
});

ipcMain.handle("safe-storage-decrypt", (_event, encrypted: string) => {
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
  } catch {
    return null;
  }
});

// IPC: Get system theme
ipcMain.handle("get-theme", () => {
  return nativeTheme.shouldUseDarkColors ? "dark" : "light";
});

// ─── Identity Key Management (main process only) ────────────────────────────
// Private key never leaves the main process. Renderer can only sign and get the public key.

interface StoredIdentity {
  publicKeyHex: string;
  encryptedPrivateKey: string; // base64, encrypted via safeStorage
  algorithm: string;
  createdAt: number;
}

let cachedIdentity: { publicKeyHex: string; privateKeyPem: string; algorithm: string } | null = null;

function getIdentityFilePath(): string {
  const dir = join(app.getPath("userData"), "identity");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "identity.json");
}

function loadIdentity(): { publicKeyHex: string; privateKeyPem: string; algorithm: string } | null {
  if (cachedIdentity) return cachedIdentity;
  const filePath = getIdentityFilePath();
  if (!existsSync(filePath)) return null;
  try {
    const stored: StoredIdentity = JSON.parse(readFileSync(filePath, "utf-8"));
    if (!safeStorage.isEncryptionAvailable()) return null;
    const privateKeyPem = safeStorage.decryptString(Buffer.from(stored.encryptedPrivateKey, "base64"));
    cachedIdentity = { publicKeyHex: stored.publicKeyHex, privateKeyPem, algorithm: stored.algorithm };
    return cachedIdentity;
  } catch {
    return null;
  }
}

function generateAndStoreIdentity(): { publicKeyHex: string; privateKeyPem: string; algorithm: string } {
  // Use ECDSA P-256 — universally supported (Node.js, Electron/BoringSSL, WebCrypto)
  const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  const publicKeyDer = publicKey.export({ type: "spki", format: "der" });
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  const publicKeyHex = publicKeyDer.toString("hex");

  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("safeStorage not available — cannot store identity securely");
  }

  const encryptedPrivateKey = safeStorage.encryptString(privateKeyPem).toString("base64");
  const stored: StoredIdentity = {
    publicKeyHex,
    encryptedPrivateKey,
    algorithm: "ECDSA-P256",
    createdAt: Date.now(),
  };
  writeFileSync(getIdentityFilePath(), JSON.stringify(stored));
  cachedIdentity = { publicKeyHex, privateKeyPem, algorithm: "ECDSA-P256" };
  return cachedIdentity;
}

ipcMain.handle("identity-get-public-key", () => {
  const id = loadIdentity() ?? generateAndStoreIdentity();
  return id.publicKeyHex;
});

ipcMain.handle("identity-sign", (_event, data: string) => {
  const id = loadIdentity() ?? generateAndStoreIdentity();
  const signer = createSign("SHA256");
  signer.update(Buffer.from(data, "utf-8"));
  signer.end();
  // dsaEncoding: "ieee-p1363" outputs raw r||s directly (no DER parsing needed)
  const key = createPrivateKey(id.privateKeyPem);
  const sig = signer.sign({ key, dsaEncoding: "ieee-p1363" });
  return sig.toString("base64");
});


ipcMain.handle("identity-regenerate", () => {
  const filePath = getIdentityFilePath();
  if (existsSync(filePath)) unlinkSync(filePath);
  cachedIdentity = null;
  const newId = generateAndStoreIdentity();
  return newId.publicKeyHex;
});

// Export identity (passphrase-encrypted) — crypto stays in main process
ipcMain.handle("identity-export", (_event, passphrase: string) => {
  const id = loadIdentity();
  if (!id) return null;
  // Use AES-256-GCM with PBKDF2-derived key
  const crypto = require("node:crypto");
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(passphrase, salt, 600_000, 32, "sha256");
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = JSON.stringify({ publicKey: id.publicKeyHex, privateKeyPem: id.privateKeyPem, algorithm: id.algorithm });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    version: 2,
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    data: Buffer.concat([encrypted, tag]).toString("hex"),
  });
});

ipcMain.handle("identity-import-encrypted", (_event, fileContents: string, passphrase: string) => {
  try {
    const file = JSON.parse(fileContents);
    if (file.version !== 2) return { success: false, error: "Unsupported identity file version" };
    const crypto = require("node:crypto");
    const salt = Buffer.from(file.salt, "hex");
    const iv = Buffer.from(file.iv, "hex");
    const raw = Buffer.from(file.data, "hex");
    const tag = raw.subarray(raw.length - 16);
    const ciphertext = raw.subarray(0, raw.length - 16);
    const key = crypto.pbkdf2Sync(passphrase, salt, 600_000, 32, "sha256");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf-8");
    const identity = JSON.parse(plaintext);
    if (!identity.publicKey || !identity.privateKeyPem) return { success: false, error: "Invalid identity file" };
    if (!safeStorage.isEncryptionAvailable()) return { success: false, error: "Secure storage unavailable" };
    const encryptedPrivateKey = safeStorage.encryptString(identity.privateKeyPem).toString("base64");
    const stored: StoredIdentity = {
      publicKeyHex: identity.publicKey,
      encryptedPrivateKey,
      algorithm: identity.algorithm ?? "Ed25519",
      createdAt: Date.now(),
    };
    writeFileSync(getIdentityFilePath(), JSON.stringify(stored));
    cachedIdentity = { publicKeyHex: identity.publicKey, privateKeyPem: identity.privateKeyPem, algorithm: identity.algorithm ?? "Ed25519" };
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message ?? "Decryption failed" };
  }
});

// ─── TOFU Identity Pin Store ─────────────────────────────────────────────────
// Persists peerUserId -> identityPublicKey per serverId.
// On first contact: pin the key ("new"). On match: "ok". On mismatch: "mismatch" (hard reject).

type PinStore = Record<string, string>; // userId -> identityPublicKeyHex
const pinCache = new Map<string, PinStore>();

function getPinFilePath(serverId: string): string {
  const dir = join(app.getPath("userData"), "identity-pins");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  // Sanitize serverId for filesystem safety
  const safe = serverId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(dir, `${safe}.json`);
}

function loadPins(serverId: string): PinStore {
  const cached = pinCache.get(serverId);
  if (cached) return cached;
  const filePath = getPinFilePath(serverId);
  if (!existsSync(filePath)) {
    pinCache.set(serverId, {});
    return {};
  }
  try {
    const pins = JSON.parse(readFileSync(filePath, "utf-8")) as PinStore;
    pinCache.set(serverId, pins);
    return pins;
  } catch {
    pinCache.set(serverId, {});
    return {};
  }
}

function savePins(serverId: string, pins: PinStore): void {
  pinCache.set(serverId, pins);
  writeFileSync(getPinFilePath(serverId), JSON.stringify(pins));
}

/**
 * Check a peer's identity key against the TOFU pin store.
 * Returns: "new" (first contact, now pinned), "ok" (matches), "mismatch" (key changed — reject)
 */
ipcMain.handle("identity-pin-check", (_event, serverId: string, userId: string, identityPublicKeyHex: string): "new" | "ok" | "mismatch" => {
  const pins = loadPins(serverId);
  const existing = pins[userId];
  if (!existing) {
    // TOFU: first contact — pin this key
    pins[userId] = identityPublicKeyHex;
    savePins(serverId, pins);
    return "new";
  }
  if (existing === identityPublicKeyHex) {
    return "ok";
  }
  return "mismatch";
});

ipcMain.handle("identity-pin-get", (_event, serverId: string, userId: string): string | null => {
  const pins = loadPins(serverId);
  return pins[userId] ?? null;
});

ipcMain.handle("identity-pin-remove", (_event, serverId: string, userId: string): void => {
  const pins = loadPins(serverId);
  delete pins[userId];
  savePins(serverId, pins);
});

nativeTheme.on("updated", () => {
  mainWindow?.webContents.send("theme-changed", nativeTheme.shouldUseDarkColors ? "dark" : "light");
});
