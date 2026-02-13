export interface RaddirAPI {
  registerPttKey: (key: string) => Promise<void>;
  unregisterPttKey: () => Promise<void>;
  getTheme: () => Promise<"dark" | "light">;
  getDesktopSources: () => Promise<Array<{ id: string; name: string; thumbnailDataUrl: string; display_id: string }>>;
  onPttPressed: (callback: () => void) => () => void;
  onThemeChanged: (callback: (theme: string) => void) => () => void;
}

declare global {
  interface Window {
    raddir?: RaddirAPI;
  }
}
