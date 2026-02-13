const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("raddir", {
  registerPttKey: (key) => ipcRenderer.invoke("register-ptt-key", key),
  unregisterPttKey: () => ipcRenderer.invoke("unregister-ptt-key"),
  trustServerHost: (host) => ipcRenderer.invoke("trust-server-host", host),
  encryptString: (plaintext) => ipcRenderer.invoke("safe-storage-encrypt", plaintext),
  decryptString: (encrypted) => ipcRenderer.invoke("safe-storage-decrypt", encrypted),
  getTheme: () => ipcRenderer.invoke("get-theme"),
  onPttPressed: (callback) => {
    ipcRenderer.on("ptt-pressed", callback);
    return () => ipcRenderer.removeListener("ptt-pressed", callback);
  },
  onThemeChanged: (callback) => {
    const handler = (_event, theme) => callback(theme);
    ipcRenderer.on("theme-changed", handler);
    return () => ipcRenderer.removeListener("theme-changed", handler);
  },
});
