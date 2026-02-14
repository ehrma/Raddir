const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("raddir", {
  registerPttKey: (key) => ipcRenderer.invoke("register-ptt-key", key),
  unregisterPttKey: () => ipcRenderer.invoke("unregister-ptt-key"),
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  getAppUpdateStatus: () => ipcRenderer.invoke("get-app-update-status"),
  checkForAppUpdates: () => ipcRenderer.invoke("check-for-app-updates"),
  installAppUpdateNow: () => ipcRenderer.invoke("install-app-update-now"),
  trustServerHost: (host) => ipcRenderer.invoke("trust-server-host", host),
  encryptString: (plaintext) => ipcRenderer.invoke("safe-storage-encrypt", plaintext),
  decryptString: (encrypted) => ipcRenderer.invoke("safe-storage-decrypt", encrypted),
  getTheme: () => ipcRenderer.invoke("get-theme"),
  // Identity key management — private key stays in main process (ECDSA P-256)
  identityGetPublicKey: () => ipcRenderer.invoke("identity-get-public-key"),
  identitySign: (data) => ipcRenderer.invoke("identity-sign", data),
  identityRegenerate: () => ipcRenderer.invoke("identity-regenerate"),
  identityExport: (passphrase) => ipcRenderer.invoke("identity-export", passphrase),
  identityImportEncrypted: (fileContents, passphrase) =>
    ipcRenderer.invoke("identity-import-encrypted", fileContents, passphrase),
  // TOFU identity pin store
  identityPinCheck: (serverId, userId, identityPublicKeyHex) =>
    ipcRenderer.invoke("identity-pin-check", serverId, userId, identityPublicKeyHex),
  identityPinGet: (serverId, userId) =>
    ipcRenderer.invoke("identity-pin-get", serverId, userId),
  identityPinRemove: (serverId, userId) =>
    ipcRenderer.invoke("identity-pin-remove", serverId, userId),
  getDesktopSources: () => ipcRenderer.invoke("get-desktop-sources"),
  onPttPressed: (callback) => {
    ipcRenderer.on("ptt-pressed", callback);
    return () => ipcRenderer.removeListener("ptt-pressed", callback);
  },
  onThemeChanged: (callback) => {
    const handler = (_event, theme) => callback(theme);
    ipcRenderer.on("theme-changed", handler);
    return () => ipcRenderer.removeListener("theme-changed", handler);
  },
  onAppUpdateStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on("app-update-status", handler);
    return () => ipcRenderer.removeListener("app-update-status", handler);
  },
});
