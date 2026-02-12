import { app as t, nativeImage as p, Tray as f, Menu as g, BrowserWindow as h, globalShortcut as n, ipcMain as a, nativeTheme as l } from "electron";
import { dirname as m, join as i } from "node:path";
import { fileURLToPath as R } from "node:url";
const w = R(import.meta.url), s = m(w);
let e = null, o = null;
function u() {
  return process.env.VITE_DEV_SERVER_URL ? i(s, "../public/icon.png") : i(s, "../dist/icon.png");
}
function d() {
  const r = u();
  e = new h({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "Raddir",
    icon: r,
    backgroundColor: l.shouldUseDarkColors ? "#0a0a0a" : "#ffffff",
    autoHideMenuBar: !0,
    webPreferences: {
      preload: i(s, "preload.cjs"),
      contextIsolation: !0,
      nodeIntegration: !1
    },
    show: !1
  }), e.once("ready-to-show", () => {
    e == null || e.show();
  }), process.env.VITE_DEV_SERVER_URL ? e.loadURL(process.env.VITE_DEV_SERVER_URL) : e.loadFile(i(s, "../dist/index.html")), e.on("closed", () => {
    e = null;
  });
}
t.commandLine.appendSwitch("ignore-certificate-errors");
t.whenReady().then(() => {
  d();
  const r = p.createFromPath(u()).resize({ width: 16, height: 16 });
  o = new f(r), o.setToolTip("Raddir"), o.setContextMenu(g.buildFromTemplate([
    { label: "Show Raddir", click: () => e == null ? void 0 : e.show() },
    { type: "separator" },
    { label: "Quit", click: () => t.quit() }
  ])), o.on("click", () => e == null ? void 0 : e.show()), t.on("activate", () => {
    h.getAllWindows().length === 0 && d();
  });
});
t.on("window-all-closed", () => {
  process.platform !== "darwin" && t.quit();
});
t.on("will-quit", () => {
  n.unregisterAll();
});
a.handle("register-ptt-key", (r, c) => {
  n.unregisterAll(), c && n.register(c, () => {
    e == null || e.webContents.send("ptt-pressed");
  });
});
a.handle("unregister-ptt-key", () => {
  n.unregisterAll();
});
a.handle("get-theme", () => l.shouldUseDarkColors ? "dark" : "light");
l.on("updated", () => {
  e == null || e.webContents.send("theme-changed", l.shouldUseDarkColors ? "dark" : "light");
});
