import { create } from "zustand";

export interface SavedServer {
  id: string;
  name: string;
  address: string;
  password?: string;
  adminToken?: string;
}

export interface SettingsState {
  theme: "dark" | "light" | "system";
  resolvedTheme: "dark" | "light";
  serverUrl: string;
  nickname: string;
  savedServers: SavedServer[];
  pttKey: string;
  voiceActivation: boolean;
  vadThreshold: number;
  inputDeviceId: string;
  outputDeviceId: string;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
  outputVolume: number;

  setTheme: (theme: "dark" | "light" | "system") => void;
  setResolvedTheme: (theme: "dark" | "light") => void;
  setServerUrl: (url: string) => void;
  setNickname: (nickname: string) => void;
  setPttKey: (key: string) => void;
  setVoiceActivation: (enabled: boolean) => void;
  setVadThreshold: (threshold: number) => void;
  setInputDeviceId: (id: string) => void;
  setOutputDeviceId: (id: string) => void;
  setNoiseSuppression: (enabled: boolean) => void;
  setEchoCancellation: (enabled: boolean) => void;
  setAutoGainControl: (enabled: boolean) => void;
  setOutputVolume: (volume: number) => void;
  addServer: (name: string, address: string, password?: string, adminToken?: string) => void;
  removeServer: (id: string) => void;
  updateServer: (id: string, name: string, address: string) => void;
  updateServerPassword: (id: string, password: string | undefined) => void;
  updateServerAdminToken: (id: string, adminToken: string | undefined) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  theme: "system",
  resolvedTheme: "dark",
  serverUrl: "localhost:4000",
  nickname: `User-${Math.random().toString(36).slice(2, 6)}`,
  savedServers: [],
  pttKey: "",
  voiceActivation: false,
  vadThreshold: -50,
  inputDeviceId: "default",
  outputDeviceId: "default",
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
  outputVolume: 1.0,

  setTheme: (theme) => set({ theme }),
  setResolvedTheme: (resolvedTheme) => set({ resolvedTheme }),
  setServerUrl: (serverUrl) => set({ serverUrl }),
  setNickname: (nickname) => set({ nickname }),
  setPttKey: (pttKey) => set({ pttKey }),
  setVoiceActivation: (voiceActivation) => set({ voiceActivation }),
  setVadThreshold: (vadThreshold) => set({ vadThreshold }),
  setInputDeviceId: (inputDeviceId) => set({ inputDeviceId }),
  setOutputDeviceId: (outputDeviceId) => set({ outputDeviceId }),
  setNoiseSuppression: (noiseSuppression) => set({ noiseSuppression }),
  setEchoCancellation: (echoCancellation) => set({ echoCancellation }),
  setAutoGainControl: (autoGainControl) => set({ autoGainControl }),
  setOutputVolume: (outputVolume) => set({ outputVolume }),
  addServer: (name, address, password, adminToken) => set((s) => ({
    savedServers: [...s.savedServers, { id: Math.random().toString(36).slice(2, 10), name, address, password: password || undefined, adminToken: adminToken || undefined }],
  })),
  removeServer: (id) => set((s) => ({
    savedServers: s.savedServers.filter((srv) => srv.id !== id),
  })),
  updateServer: (id, name, address) => set((s) => ({
    savedServers: s.savedServers.map((srv) => srv.id === id ? { ...srv, name, address } : srv),
  })),
  updateServerPassword: (id: string, password: string | undefined) => set((s) => ({
    savedServers: s.savedServers.map((srv) => srv.id === id ? { ...srv, password } : srv),
  })),
  updateServerAdminToken: (id: string, adminToken: string | undefined) => set((s) => ({
    savedServers: s.savedServers.map((srv) => srv.id === id ? { ...srv, adminToken } : srv),
  })),
}));
