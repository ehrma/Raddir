import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("raddir", {
  registerPttKey: (key: string) => ipcRenderer.invoke("register-ptt-key", key),
  unregisterPttKey: () => ipcRenderer.invoke("unregister-ptt-key"),
  trustServerHost: (host: string) => ipcRenderer.invoke("trust-server-host", host),
  encryptString: (plaintext: string) => ipcRenderer.invoke("safe-storage-encrypt", plaintext),
  decryptString: (encrypted: string) => ipcRenderer.invoke("safe-storage-decrypt", encrypted),
  getTheme: () => ipcRenderer.invoke("get-theme"),
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
