import { app, nativeImage, Tray, Menu, BrowserWindow, globalShortcut, ipcMain, safeStorage, nativeTheme } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { createSign, createPrivateKey, generateKeyPairSync } from "node:crypto";
const __filename$1 = fileURLToPath(import.meta.url);
const __dirname$1 = dirname(__filename$1);
let mainWindow = null;
let tray = null;
let trustedServerHost = null;
function getTrayIconPath() {
  if (process.env.VITE_DEV_SERVER_URL) {
    return join(__dirname$1, "../public/raddir-tray-icon.png");
  }
  return join(__dirname$1, "../dist/raddir-tray-icon.png");
}
function createWindow() {
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
      preload: join(__dirname$1, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    },
    show: false
  });
  mainWindow.once("ready-to-show", () => {
    mainWindow == null ? void 0 : mainWindow.show();
  });
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(join(__dirname$1, "../dist/index.html"));
  }
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}
app.on("certificate-error", (event, _webContents, url, _error, _certificate, callback) => {
  try {
    const parsed = new URL(url);
    if (trustedServerHost && parsed.host === trustedServerHost) {
      event.preventDefault();
      callback(true);
      return;
    }
  } catch {
  }
  callback(false);
});
app.whenReady().then(() => {
  createWindow();
  const trayImage = nativeImage.createFromPath(getTrayIconPath());
  const tempTrayPath = join(app.getPath("temp"), `raddir-tray-${Date.now()}.png`);
  writeFileSync(tempTrayPath, trayImage.toPNG());
  tray = new Tray(tempTrayPath);
  tray.setToolTip("Raddir");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Show Raddir", click: () => mainWindow == null ? void 0 : mainWindow.show() },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() }
  ]));
  tray.on("click", () => mainWindow == null ? void 0 : mainWindow.show());
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
ipcMain.handle("register-ptt-key", (_event, key) => {
  globalShortcut.unregisterAll();
  if (!key) return;
  globalShortcut.register(key, () => {
    mainWindow == null ? void 0 : mainWindow.webContents.send("ptt-pressed");
  });
});
ipcMain.handle("unregister-ptt-key", () => {
  globalShortcut.unregisterAll();
});
ipcMain.handle("trust-server-host", (_event, host) => {
  trustedServerHost = host || null;
});
ipcMain.handle("safe-storage-encrypt", (_event, plaintext) => {
  if (!safeStorage.isEncryptionAvailable()) return null;
  return safeStorage.encryptString(plaintext).toString("base64");
});
ipcMain.handle("safe-storage-decrypt", (_event, encrypted) => {
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
  } catch {
    return null;
  }
});
ipcMain.handle("get-theme", () => {
  return nativeTheme.shouldUseDarkColors ? "dark" : "light";
});
let cachedIdentity = null;
function getIdentityFilePath() {
  const dir = join(app.getPath("userData"), "identity");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "identity.json");
}
function loadIdentity() {
  if (cachedIdentity) return cachedIdentity;
  const filePath = getIdentityFilePath();
  if (!existsSync(filePath)) return null;
  try {
    const stored = JSON.parse(readFileSync(filePath, "utf-8"));
    if (!safeStorage.isEncryptionAvailable()) return null;
    const privateKeyPem = safeStorage.decryptString(Buffer.from(stored.encryptedPrivateKey, "base64"));
    cachedIdentity = { publicKeyHex: stored.publicKeyHex, privateKeyPem, algorithm: stored.algorithm };
    return cachedIdentity;
  } catch {
    return null;
  }
}
function generateAndStoreIdentity() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256"
  });
  const publicKeyDer = publicKey.export({ type: "spki", format: "der" });
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
  const publicKeyHex = publicKeyDer.toString("hex");
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("safeStorage not available — cannot store identity securely");
  }
  const encryptedPrivateKey = safeStorage.encryptString(privateKeyPem).toString("base64");
  const stored = {
    publicKeyHex,
    encryptedPrivateKey,
    algorithm: "ECDSA-P256",
    createdAt: Date.now()
  };
  writeFileSync(getIdentityFilePath(), JSON.stringify(stored));
  cachedIdentity = { publicKeyHex, privateKeyPem, algorithm: "ECDSA-P256" };
  return cachedIdentity;
}
ipcMain.handle("identity-get-public-key", () => {
  const id = loadIdentity() ?? generateAndStoreIdentity();
  return id.publicKeyHex;
});
ipcMain.handle("identity-sign", (_event, data) => {
  const id = loadIdentity() ?? generateAndStoreIdentity();
  const signer = createSign("SHA256");
  signer.update(Buffer.from(data, "utf-8"));
  signer.end();
  const key = createPrivateKey(id.privateKeyPem);
  const sig = signer.sign({ key, dsaEncoding: "ieee-p1363" });
  return sig.toString("base64");
});
ipcMain.handle("identity-export", (_event, passphrase) => {
  const id = loadIdentity();
  if (!id) return null;
  const crypto = require("node:crypto");
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(passphrase, salt, 6e5, 32, "sha256");
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = JSON.stringify({ publicKey: id.publicKeyHex, privateKeyPem: id.privateKeyPem, algorithm: id.algorithm });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    version: 2,
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    data: Buffer.concat([encrypted, tag]).toString("hex")
  });
});
ipcMain.handle("identity-import-encrypted", (_event, fileContents, passphrase) => {
  try {
    const file = JSON.parse(fileContents);
    if (file.version !== 2) return { success: false, error: "Unsupported identity file version" };
    const crypto = require("node:crypto");
    const salt = Buffer.from(file.salt, "hex");
    const iv = Buffer.from(file.iv, "hex");
    const raw = Buffer.from(file.data, "hex");
    const tag = raw.subarray(raw.length - 16);
    const ciphertext = raw.subarray(0, raw.length - 16);
    const key = crypto.pbkdf2Sync(passphrase, salt, 6e5, 32, "sha256");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf-8");
    const identity = JSON.parse(plaintext);
    if (!identity.publicKey || !identity.privateKeyPem) return { success: false, error: "Invalid identity file" };
    if (!safeStorage.isEncryptionAvailable()) return { success: false, error: "Secure storage unavailable" };
    const encryptedPrivateKey = safeStorage.encryptString(identity.privateKeyPem).toString("base64");
    const stored = {
      publicKeyHex: identity.publicKey,
      encryptedPrivateKey,
      algorithm: identity.algorithm ?? "Ed25519",
      createdAt: Date.now()
    };
    writeFileSync(getIdentityFilePath(), JSON.stringify(stored));
    cachedIdentity = { publicKeyHex: identity.publicKey, privateKeyPem: identity.privateKeyPem, algorithm: identity.algorithm ?? "Ed25519" };
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message ?? "Decryption failed" };
  }
});
const pinCache = /* @__PURE__ */ new Map();
function getPinFilePath(serverId) {
  const dir = join(app.getPath("userData"), "identity-pins");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const safe = serverId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(dir, `${safe}.json`);
}
function loadPins(serverId) {
  const cached = pinCache.get(serverId);
  if (cached) return cached;
  const filePath = getPinFilePath(serverId);
  if (!existsSync(filePath)) {
    pinCache.set(serverId, {});
    return {};
  }
  try {
    const pins = JSON.parse(readFileSync(filePath, "utf-8"));
    pinCache.set(serverId, pins);
    return pins;
  } catch {
    pinCache.set(serverId, {});
    return {};
  }
}
function savePins(serverId, pins) {
  pinCache.set(serverId, pins);
  writeFileSync(getPinFilePath(serverId), JSON.stringify(pins));
}
ipcMain.handle("identity-pin-check", (_event, serverId, userId, identityPublicKeyHex) => {
  const pins = loadPins(serverId);
  const existing = pins[userId];
  if (!existing) {
    pins[userId] = identityPublicKeyHex;
    savePins(serverId, pins);
    return "new";
  }
  if (existing === identityPublicKeyHex) {
    return "ok";
  }
  return "mismatch";
});
ipcMain.handle("identity-pin-get", (_event, serverId, userId) => {
  const pins = loadPins(serverId);
  return pins[userId] ?? null;
});
ipcMain.handle("identity-pin-remove", (_event, serverId, userId) => {
  const pins = loadPins(serverId);
  delete pins[userId];
  savePins(serverId, pins);
});
nativeTheme.on("updated", () => {
  mainWindow == null ? void 0 : mainWindow.webContents.send("theme-changed", nativeTheme.shouldUseDarkColors ? "dark" : "light");
});
