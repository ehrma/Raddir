import { app, BrowserWindow, globalShortcut, ipcMain, nativeTheme, Tray, Menu, nativeImage } from "electron";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

function getIconPath(): string {
  // In dev, icon is in public/; in production, it's in dist/
  if (process.env.VITE_DEV_SERVER_URL) {
    return join(__dirname, "../public/icon.png");
  }
  return join(__dirname, "../dist/icon.png");
}

function createWindow(): void {
  const iconPath = getIconPath();

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "Raddir",
    icon: iconPath,
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

// Accept self-signed TLS certificates (Raddir server generates one automatically)
app.commandLine.appendSwitch("ignore-certificate-errors");

app.whenReady().then(() => {
  createWindow();

  // System tray
  const trayIcon = nativeImage.createFromPath(getIconPath()).resize({ width: 16, height: 16 });
  tray = new Tray(trayIcon);
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

// IPC: Get system theme
ipcMain.handle("get-theme", () => {
  return nativeTheme.shouldUseDarkColors ? "dark" : "light";
});

nativeTheme.on("updated", () => {
  mainWindow?.webContents.send("theme-changed", nativeTheme.shouldUseDarkColors ? "dark" : "light");
});
