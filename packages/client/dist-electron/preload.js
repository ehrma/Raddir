import { contextBridge as o, ipcRenderer as e } from "electron";
o.exposeInMainWorld("raddir", {
  registerPttKey: (t) => e.invoke("register-ptt-key", t),
  unregisterPttKey: () => e.invoke("unregister-ptt-key"),
  getTheme: () => e.invoke("get-theme"),
  onPttPressed: (t) => (e.on("ptt-pressed", t), () => e.removeListener("ptt-pressed", t)),
  onThemeChanged: (t) => {
    const r = (i, n) => t(n);
    return e.on("theme-changed", r), () => e.removeListener("theme-changed", r);
  }
});
