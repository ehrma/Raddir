import { useSettingsStore } from "../stores/settingsStore";

const SETTINGS_KEY = "raddir-settings";

interface PersistedSettings {
  theme: "dark" | "light" | "system";
  serverUrl: string;
  nickname: string;
  pttKey: string;
  voiceActivation: boolean;
  vadThreshold: number;
  inputDeviceId: string;
  outputDeviceId: string;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
  outputVolume: number;
  savedServers: Array<{ id: string; name: string; address: string }>;
}

export function loadSettings(): void {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;

    const saved = JSON.parse(raw) as Partial<PersistedSettings>;
    const store = useSettingsStore.getState();

    if (saved.theme) store.setTheme(saved.theme);
    if (saved.serverUrl) store.setServerUrl(saved.serverUrl);
    if (saved.nickname) store.setNickname(saved.nickname);
    if (saved.pttKey !== undefined) store.setPttKey(saved.pttKey);
    if (saved.voiceActivation !== undefined) store.setVoiceActivation(saved.voiceActivation);
    if (saved.vadThreshold !== undefined) store.setVadThreshold(saved.vadThreshold);
    if (saved.inputDeviceId) store.setInputDeviceId(saved.inputDeviceId);
    if (saved.outputDeviceId) store.setOutputDeviceId(saved.outputDeviceId);
    if (saved.noiseSuppression !== undefined) store.setNoiseSuppression(saved.noiseSuppression);
    if (saved.echoCancellation !== undefined) store.setEchoCancellation(saved.echoCancellation);
    if (saved.autoGainControl !== undefined) store.setAutoGainControl(saved.autoGainControl);
    if (saved.outputVolume !== undefined) store.setOutputVolume(saved.outputVolume);
    if (saved.savedServers?.length) {
      useSettingsStore.setState({ savedServers: saved.savedServers });
    }
  } catch {
    console.warn("[settings] Failed to load persisted settings");
  }
}

export function saveSettings(): void {
  try {
    const state = useSettingsStore.getState();
    const data: PersistedSettings = {
      theme: state.theme,
      serverUrl: state.serverUrl,
      nickname: state.nickname,
      pttKey: state.pttKey,
      voiceActivation: state.voiceActivation,
      vadThreshold: state.vadThreshold,
      inputDeviceId: state.inputDeviceId,
      outputDeviceId: state.outputDeviceId,
      noiseSuppression: state.noiseSuppression,
      echoCancellation: state.echoCancellation,
      autoGainControl: state.autoGainControl,
      outputVolume: state.outputVolume,
      savedServers: state.savedServers,
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
  } catch {
    console.warn("[settings] Failed to save settings");
  }
}

// Auto-save on any settings change
useSettingsStore.subscribe(() => {
  saveSettings();
});
