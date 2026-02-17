import { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, nativeTheme, Tray, Menu, nativeImage, safeStorage, session } from "electron";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { generateKeyPairSync, createSign, createPrivateKey } from "node:crypto";
import { autoUpdater, type ProgressInfo, type UpdateInfo } from "electron-updater";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let trustedServerHost: string | null = null;
let hasDownloadedUpdate = false;
let pendingScreenShareSelection: { sourceId: string; includeAudio: boolean } | null = null;

type ShortcutAction = "ptt" | "mute-toggle" | "deafen-toggle";
const shortcutAccelerators = new Map<ShortcutAction, string>();
const shortcutLastTriggerAt = new Map<ShortcutAction, number>();

type AppUpdateStatus =
  | { state: "idle" }
  | { state: "disabled"; reason: string }
  | { state: "checking" }
  | { state: "available"; version: string }
  | { state: "downloading"; percent: number }
  | { state: "not-available" }
  | { state: "downloaded"; version: string }
  | { state: "error"; message: string };

let latestAppUpdateStatus: AppUpdateStatus = { state: "idle" };

function emitAppUpdateStatus(status: AppUpdateStatus): void {
  latestAppUpdateStatus = status;
  mainWindow?.webContents.send("app-update-status", status);
}

function setupAutoUpdater(): void {
  if (!app.isPackaged) {
    emitAppUpdateStatus({ state: "disabled", reason: "development-build" });
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    emitAppUpdateStatus({ state: "checking" });
  });

  autoUpdater.on("update-available", (info: UpdateInfo) => {
    emitAppUpdateStatus({ state: "available", version: info.version });
  });

  autoUpdater.on("download-progress", (progress: ProgressInfo) => {
    emitAppUpdateStatus({ state: "downloading", percent: Math.round(progress.percent) });
  });

  autoUpdater.on("update-not-available", () => {
    emitAppUpdateStatus({ state: "not-available" });
  });

  autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
    hasDownloadedUpdate = true;
    emitAppUpdateStatus({ state: "downloaded", version: info.version });
  });

  autoUpdater.on("error", (error: Error) => {
    emitAppUpdateStatus({
      state: "error",
      message: error?.message ?? "Failed to check for updates",
    });
  });

  void autoUpdater.checkForUpdates().catch((error: unknown) => {
    emitAppUpdateStatus({
      state: "error",
      message: error instanceof Error ? error.message : "Failed to check for updates",
    });
  });
}

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

  mainWindow.webContents.once("did-finish-load", () => {
    mainWindow?.webContents.send("app-update-status", latestAppUpdateStatus);
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

  // Route renderer getDisplayMedia requests through the source chosen in our custom picker.
  // This avoids risky chromeMediaSource constraints in the renderer and enables safe loopback audio.
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const pending = pendingScreenShareSelection;
    pendingScreenShareSelection = null;

    if (!pending) {
      callback({});
      return;
    }

    try {
      const sources = await desktopCapturer.getSources({
        types: ["screen", "window"],
        thumbnailSize: { width: 1, height: 1 },
      });
      const source = sources.find((s) => s.id === pending.sourceId);
      if (!source) {
        callback({});
        return;
      }

      const allowLoopbackAudio = pending.includeAudio && source.id.startsWith("screen:");
      callback({
        video: source,
        ...(allowLoopbackAudio ? { audio: "loopback" as const } : {}),
      });
    } catch (err) {
      console.error("[screen-share] Failed to resolve selected source:", err);
      callback({});
    }
  }, {
    useSystemPicker: false,
  });

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

  setupAutoUpdater();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  shortcutAccelerators.clear();
  shortcutLastTriggerAt.clear();
});

function normalizePttAccelerator(key: string): string {
  if (!key) return "";

  // KeyboardEvent.code from renderer key capture
  if (key.startsWith("Key") && key.length === 4) {
    return key.slice(3).toUpperCase();
  }
  if (key.startsWith("Digit") && key.length === 6) {
    return key.slice(5);
  }

  const map: Record<string, string> = {
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Escape: "Esc",
    ControlLeft: "Control",
    ControlRight: "Control",
    ShiftLeft: "Shift",
    ShiftRight: "Shift",
    AltLeft: "Alt",
    AltRight: "Alt",
    MetaLeft: "Super",
    MetaRight: "Super",
  };

  return map[key] ?? key;
}

function actionEventName(action: ShortcutAction): string {
  switch (action) {
    case "ptt": return "ptt-pressed";
    case "mute-toggle": return "mute-toggle-pressed";
    case "deafen-toggle": return "deafen-toggle-pressed";
  }
}

function emitShortcutAction(action: ShortcutAction): void {
  const now = Date.now();
  const last = shortcutLastTriggerAt.get(action) ?? 0;
  if (now - last < 120) return;
  shortcutLastTriggerAt.set(action, now);
  mainWindow?.webContents.send(actionEventName(action));
}

function unregisterShortcutAction(action: ShortcutAction): void {
  const existing = shortcutAccelerators.get(action);
  if (!existing) return;
  globalShortcut.unregister(existing);
  shortcutAccelerators.delete(action);
}

function registerShortcutAction(action: ShortcutAction, key: string): void {
  unregisterShortcutAction(action);

  if (!key) return;

  const accelerator = normalizePttAccelerator(key);
  if (!accelerator) return;

  try {
    const ok = globalShortcut.register(accelerator, () => {
      emitShortcutAction(action);
    });

    if (!ok) {
      console.warn(`[hotkey] Failed to register ${action}: ${accelerator}`);
      return;
    }

    shortcutAccelerators.set(action, accelerator);
  } catch (err) {
    console.warn(`[hotkey] Invalid shortcut for ${action}: ${accelerator}`, err);
  }
}

// IPC: Push-to-talk global shortcut registration
ipcMain.handle("register-ptt-key", (_event, key: string) => {
  registerShortcutAction("ptt", key);
});

ipcMain.handle("unregister-ptt-key", () => {
  unregisterShortcutAction("ptt");
});

ipcMain.handle("register-mute-key", (_event, key: string) => {
  registerShortcutAction("mute-toggle", key);
});

ipcMain.handle("unregister-mute-key", () => {
  unregisterShortcutAction("mute-toggle");
});

ipcMain.handle("register-deafen-key", (_event, key: string) => {
  registerShortcutAction("deafen-toggle", key);
});

ipcMain.handle("unregister-deafen-key", () => {
  unregisterShortcutAction("deafen-toggle");
});

ipcMain.handle("get-app-version", () => {
  return app.getVersion();
});

ipcMain.handle("get-app-update-status", () => {
  return latestAppUpdateStatus;
});

ipcMain.handle("check-for-app-updates", async () => {
  if (!app.isPackaged) {
    const status = { state: "disabled", reason: "development-build" } as const;
    emitAppUpdateStatus(status);
    return { ok: false, reason: status.reason };
  }

  try {
    await autoUpdater.checkForUpdates();
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to check for updates";
    emitAppUpdateStatus({ state: "error", message });
    return { ok: false, reason: message };
  }
});

ipcMain.handle("install-app-update-now", () => {
  if (!hasDownloadedUpdate) return false;
  setImmediate(() => autoUpdater.quitAndInstall());
  return true;
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

// IPC: Get desktop sources for screen sharing (Electron desktopCapturer)
ipcMain.handle("get-desktop-sources", async () => {
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 320, height: 180 },
  });
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    thumbnailDataUrl: s.thumbnail.toDataURL(),
    display_id: s.display_id,
  }));
});

ipcMain.handle("set-screen-share-source", (_event, sourceId: string, includeAudio: boolean) => {
  pendingScreenShareSelection = { sourceId, includeAudio };
  return true;
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
