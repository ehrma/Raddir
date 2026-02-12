import { app, BrowserWindow, globalShortcut, ipcMain, nativeTheme, Tray, Menu, nativeImage } from "electron";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let trustedServerHost: string | null = null;

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
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

// IPC: Push-to-talk global shortcut registration
ipcMain.handle("register-ptt-key", (_event, key: string) => {
  globalShortcut.unregisterAll();

  if (!key) return;

  globalShortcut.register(key, () => {
    mainWindow?.webContents.send("ptt-pressed");
  });

  // There's no "key up" event for globalShortcut, so we use a polling approach
  // The renderer will handle PTT state via keydown/keyup for focused window
  // and globalShortcut for unfocused window
});

ipcMain.handle("unregister-ptt-key", () => {
  globalShortcut.unregisterAll();
});

// IPC: Register the Raddir server host to trust its self-signed certificate
ipcMain.handle("trust-server-host", (_event, host: string) => {
  trustedServerHost = host || null;
});

// IPC: Get system theme
ipcMain.handle("get-theme", () => {
  return nativeTheme.shouldUseDarkColors ? "dark" : "light";
});

nativeTheme.on("updated", () => {
  mainWindow?.webContents.send("theme-changed", nativeTheme.shouldUseDarkColors ? "dark" : "light");
});
