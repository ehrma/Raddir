import { app, BrowserWindow, globalShortcut, ipcMain, nativeTheme } from "electron";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "Raddir",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
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
