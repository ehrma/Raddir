import { app, nativeImage, Tray, Menu, BrowserWindow, globalShortcut, ipcMain, nativeTheme } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
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
ipcMain.handle("get-theme", () => {
  return nativeTheme.shouldUseDarkColors ? "dark" : "light";
});
nativeTheme.on("updated", () => {
  mainWindow == null ? void 0 : mainWindow.webContents.send("theme-changed", nativeTheme.shouldUseDarkColors ? "dark" : "light");
});
