import { create } from "zustand";

export type ThemeMode = "dark" | "light" | "system";

interface ThemeState {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

const STORAGE_KEY = "raddir-theme";

function getStoredMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "dark" || stored === "light" || stored === "system") return stored;
  } catch {}
  return "system";
}

function getSystemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(mode: ThemeMode): void {
  const isDark = mode === "dark" || (mode === "system" && getSystemPrefersDark());
  document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
}

export const useThemeStore = create<ThemeState>((set) => ({
  mode: getStoredMode(),
  setMode: (mode) => {
    localStorage.setItem(STORAGE_KEY, mode);
    applyTheme(mode);
    set({ mode });
  },
}));

// Apply theme on load
applyTheme(useThemeStore.getState().mode);

// Listen for OS theme changes when in "system" mode
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  const { mode } = useThemeStore.getState();
  if (mode === "system") {
    applyTheme("system");
  }
});
