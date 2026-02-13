import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("raddir", {
  registerPttKey: (key: string) => ipcRenderer.invoke("register-ptt-key", key),
  unregisterPttKey: () => ipcRenderer.invoke("unregister-ptt-key"),
  trustServerHost: (host: string) => ipcRenderer.invoke("trust-server-host", host),
  encryptString: (plaintext: string) => ipcRenderer.invoke("safe-storage-encrypt", plaintext),
  decryptString: (encrypted: string) => ipcRenderer.invoke("safe-storage-decrypt", encrypted),
  getTheme: () => ipcRenderer.invoke("get-theme"),
  // Identity key management — private key stays in main process (ECDSA P-256)
  identityGetPublicKey: () => ipcRenderer.invoke("identity-get-public-key"),
  identitySign: (data: string) => ipcRenderer.invoke("identity-sign", data),
  identityExport: (passphrase: string) => ipcRenderer.invoke("identity-export", passphrase),
  identityImportEncrypted: (fileContents: string, passphrase: string) =>
    ipcRenderer.invoke("identity-import-encrypted", fileContents, passphrase),
  // TOFU identity pin store
  identityPinCheck: (serverId: string, userId: string, identityPublicKeyHex: string) =>
    ipcRenderer.invoke("identity-pin-check", serverId, userId, identityPublicKeyHex) as Promise<"new" | "ok" | "mismatch">,
  identityPinGet: (serverId: string, userId: string) =>
    ipcRenderer.invoke("identity-pin-get", serverId, userId) as Promise<string | null>,
  identityPinRemove: (serverId: string, userId: string) =>
    ipcRenderer.invoke("identity-pin-remove", serverId, userId) as Promise<void>,
  onPttPressed: (callback: () => void) => {
    ipcRenderer.on("ptt-pressed", callback);
    return () => ipcRenderer.removeListener("ptt-pressed", callback);
  },
  onThemeChanged: (callback: (theme: string) => void) => {
    const handler = (_event: any, theme: string) => callback(theme);
    ipcRenderer.on("theme-changed", handler);
    return () => ipcRenderer.removeListener("theme-changed", handler);
  },
});
