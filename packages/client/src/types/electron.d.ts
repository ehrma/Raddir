export type AppUpdateStatus =
  | { state: "idle" }
  | { state: "disabled"; reason: string }
  | { state: "checking" }
  | { state: "available"; version: string }
  | { state: "downloading"; percent: number }
  | { state: "not-available" }
  | { state: "downloaded"; version: string }
  | { state: "error"; message: string };

export interface RaddirAPI {
  registerPttKey: (key: string) => Promise<void>;
  unregisterPttKey: () => Promise<void>;
  registerMuteKey: (key: string) => Promise<void>;
  unregisterMuteKey: () => Promise<void>;
  registerDeafenKey: (key: string) => Promise<void>;
  unregisterDeafenKey: () => Promise<void>;
  getAppVersion: () => Promise<string>;
  getAppUpdateStatus: () => Promise<AppUpdateStatus>;
  checkForAppUpdates: () => Promise<{ ok: boolean; reason?: string }>;
  installAppUpdateNow: () => Promise<boolean>;
  getTheme: () => Promise<"dark" | "light">;
  getDesktopSources: () => Promise<Array<{ id: string; name: string; thumbnailDataUrl: string; display_id: string }>>;
  setScreenShareSource: (sourceId: string, includeAudio: boolean) => Promise<boolean>;
  onPttPressed: (callback: () => void) => () => void;
  onMuteTogglePressed: (callback: () => void) => () => void;
  onDeafenTogglePressed: (callback: () => void) => () => void;
  onThemeChanged: (callback: (theme: string) => void) => () => void;
  onAppUpdateStatus: (callback: (status: AppUpdateStatus) => void) => () => void;
}

declare global {
  interface Window {
    raddir?: RaddirAPI;
  }
}
