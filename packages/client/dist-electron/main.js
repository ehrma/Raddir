import { app, BrowserWindow, globalShortcut, ipcMain, nativeTheme } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const __filename$1 = fileURLToPath(import.meta.url);
const __dirname$1 = dirname(__filename$1);
let mainWindow = null;
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "Raddir",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname$1, "preload.js"),
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
app.commandLine.appendSwitch("ignore-certificate-errors");
app.whenReady().then(() => {
  createWindow();
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
ipcMain.handle("get-theme", () => {
  return nativeTheme.shouldUseDarkColors ? "dark" : "light";
});
nativeTheme.on("updated", () => {
  mainWindow == null ? void 0 : mainWindow.webContents.send("theme-changed", nativeTheme.shouldUseDarkColors ? "dark" : "light");
});
