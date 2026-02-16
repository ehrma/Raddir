import { useSettingsStore, type SavedServer } from "../stores/settingsStore";

const SETTINGS_KEY = "raddir-settings";
const ENCRYPTED_PREFIX = "enc:";

interface PersistedSettings {
  theme: "dark" | "light" | "system";
  serverUrl: string;
  nickname: string;
  pttKey: string;
  muteKey: string;
  deafenKey: string;
  voiceActivation: boolean;
  vadThreshold: number;
  inputDeviceId: string;
  outputDeviceId: string;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
  outputVolume: number;
  savedServers: Array<{ id: string; name: string; address: string; password?: string; adminToken?: string; credential?: string }>;
}

// ─── Encryption helpers (Electron safeStorage via preload IPC) ──────────────

async function encrypt(value: string | undefined): Promise<string | undefined> {
  if (!value) return undefined;
  try {
    const encrypted = await (window as any).raddir?.encryptString(value);
    if (encrypted) return ENCRYPTED_PREFIX + encrypted;
  } catch {}
  // safeStorage unavailable — refuse to persist secret in plaintext
  return undefined;
}

async function decrypt(value: string | undefined): Promise<string | undefined> {
  if (!value) return undefined;
  if (!value.startsWith(ENCRYPTED_PREFIX)) return value; // already plaintext (legacy)
  try {
    const decrypted = await (window as any).raddir?.decryptString(value.slice(ENCRYPTED_PREFIX.length));
    if (decrypted !== null && decrypted !== undefined) return decrypted;
  } catch {}
  return undefined; // decryption failed — credential is lost
}

async function encryptServer(server: SavedServer): Promise<SavedServer> {
  return {
    ...server,
    password: await encrypt(server.password),
    adminToken: await encrypt(server.adminToken),
    credential: await encrypt(server.credential),
  };
}

async function decryptServer(server: SavedServer): Promise<SavedServer> {
  return {
    ...server,
    password: await decrypt(server.password),
    adminToken: await decrypt(server.adminToken),
    credential: await decrypt(server.credential),
  };
}

// ─── Load / Save ────────────────────────────────────────────────────────────

export async function loadSettings(): Promise<void> {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;

    const saved = JSON.parse(raw) as Partial<PersistedSettings>;
    const store = useSettingsStore.getState();

    if (saved.theme) store.setTheme(saved.theme);
    if (saved.serverUrl) store.setServerUrl(saved.serverUrl);
    if (saved.nickname) store.setNickname(saved.nickname);
    if (saved.pttKey !== undefined) store.setPttKey(saved.pttKey);
    if (saved.muteKey !== undefined) store.setMuteKey(saved.muteKey);
    if (saved.deafenKey !== undefined) store.setDeafenKey(saved.deafenKey);
    if (saved.voiceActivation !== undefined) store.setVoiceActivation(saved.voiceActivation);
    if (saved.vadThreshold !== undefined) store.setVadThreshold(saved.vadThreshold);
    if (saved.inputDeviceId) store.setInputDeviceId(saved.inputDeviceId);
    if (saved.outputDeviceId) store.setOutputDeviceId(saved.outputDeviceId);
    if (saved.noiseSuppression !== undefined) store.setNoiseSuppression(saved.noiseSuppression);
    if (saved.echoCancellation !== undefined) store.setEchoCancellation(saved.echoCancellation);
    if (saved.autoGainControl !== undefined) store.setAutoGainControl(saved.autoGainControl);
    if (saved.outputVolume !== undefined) store.setOutputVolume(saved.outputVolume);
    if (saved.savedServers?.length) {
      const decrypted = await Promise.all(saved.savedServers.map(decryptServer));
      useSettingsStore.setState({ savedServers: decrypted });
    }
  } catch {
    console.warn("[settings] Failed to load persisted settings");
  }
}

export async function saveSettings(): Promise<void> {
  try {
    const state = useSettingsStore.getState();
    const encryptedServers = await Promise.all(state.savedServers.map(encryptServer));
    const data: PersistedSettings = {
      theme: state.theme,
      serverUrl: state.serverUrl,
      nickname: state.nickname,
      pttKey: state.pttKey,
      muteKey: state.muteKey,
      deafenKey: state.deafenKey,
      voiceActivation: state.voiceActivation,
      vadThreshold: state.vadThreshold,
      inputDeviceId: state.inputDeviceId,
      outputDeviceId: state.outputDeviceId,
      noiseSuppression: state.noiseSuppression,
      echoCancellation: state.echoCancellation,
      autoGainControl: state.autoGainControl,
      outputVolume: state.outputVolume,
      savedServers: encryptedServers,
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
  } catch {
    console.warn("[settings] Failed to save settings");
  }
}

// Auto-save on any settings change (debounced to avoid rapid writes during encryption)
let saveTimer: ReturnType<typeof setTimeout> | null = null;
useSettingsStore.subscribe(() => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveSettings(), 300);
});
