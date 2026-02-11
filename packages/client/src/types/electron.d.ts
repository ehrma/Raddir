export interface RaddirAPI {
  registerPttKey: (key: string) => Promise<void>;
  unregisterPttKey: () => Promise<void>;
  getTheme: () => Promise<"dark" | "light">;
  onPttPressed: (callback: () => void) => () => void;
  onThemeChanged: (callback: (theme: string) => void) => () => void;
}

declare global {
  interface Window {
    raddir?: RaddirAPI;
  }
}
