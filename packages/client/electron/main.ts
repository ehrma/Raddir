import { app, BrowserWindow, globalShortcut, ipcMain, nativeTheme, Tray, Menu, nativeImage, safeStorage } from "electron";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { createSign, createVerify, generateKeyPairSync, createHash } from "node:crypto";

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
  // Use Ed25519 (Node.js has native support)
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
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
    algorithm: "Ed25519",
    createdAt: Date.now(),
  };
  writeFileSync(getIdentityFilePath(), JSON.stringify(stored));
  cachedIdentity = { publicKeyHex, privateKeyPem, algorithm: "Ed25519" };
  return cachedIdentity;
}

ipcMain.handle("identity-get-public-key", () => {
  const id = loadIdentity() ?? generateAndStoreIdentity();
  return id.publicKeyHex;
});

ipcMain.handle("identity-sign", (_event, data: string) => {
  const id = loadIdentity() ?? generateAndStoreIdentity();
  const sign = createSign("Ed25519");
  // Ed25519 does not use a separate digest — pass data directly
  sign.end(Buffer.from(data, "utf-8"));
  // Node's Ed25519 sign: no digest algorithm needed, just call sign with the PEM key
  return sign.sign(id.privateKeyPem).toString("base64");
});

ipcMain.handle("identity-get-algorithm", () => {
  const id = loadIdentity() ?? generateAndStoreIdentity();
  return id.algorithm;
});

// Migration: import an existing identity from the renderer (one-time, from localStorage)
ipcMain.handle("identity-import-legacy", (_event, publicKeyHex: string, privateKeyHex: string, algorithm: string) => {
  // Only import if we don't already have an identity
  if (loadIdentity()) return false;
  if (!safeStorage.isEncryptionAvailable()) return false;

  try {
    // Convert hex PKCS8 to PEM
    const derBuffer = Buffer.from(privateKeyHex, "hex");
    const b64 = derBuffer.toString("base64");
    const pem = `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----`;

    const encryptedPrivateKey = safeStorage.encryptString(pem).toString("base64");
    const stored: StoredIdentity = {
      publicKeyHex,
      encryptedPrivateKey,
      algorithm,
      createdAt: Date.now(),
    };
    writeFileSync(getIdentityFilePath(), JSON.stringify(stored));
    cachedIdentity = { publicKeyHex, privateKeyPem: pem, algorithm };
    return true;
  } catch (err) {
    console.error("[identity] Failed to import legacy identity:", err);
    return false;
  }
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

nativeTheme.on("updated", () => {
  mainWindow?.webContents.send("theme-changed", nativeTheme.shouldUseDarkColors ? "dark" : "light");
});
