import { useEffect } from "react";
import { useServerStore } from "./stores/serverStore";
import { useSettingsStore } from "./stores/settingsStore";
import { ConnectScreen } from "./components/ConnectScreen";
import { MainLayout } from "./components/MainLayout";
import { ReconnectOverlay } from "./components/ReconnectOverlay";
import { Notification } from "./components/Notification";
import { useConnection } from "./hooks/useConnection";
import { loadSettings } from "./lib/settings-persistence";

export function App() {
  const { connected, authenticated } = useServerStore();
  const { theme, setResolvedTheme } = useSettingsStore();
  const { kickReason, banReason, setKickReason, setBanReason } = useConnection();

  // Load persisted settings on mount
  useEffect(() => {
    loadSettings();
  }, []);

  // Theme management
  useEffect(() => {
    const applyTheme = (resolved: "dark" | "light") => {
      setResolvedTheme(resolved);
      document.documentElement.classList.toggle("dark", resolved === "dark");
    };

    if (theme === "system") {
      if (window.raddir?.getTheme) {
        window.raddir.getTheme().then(applyTheme);
        const unsub = window.raddir.onThemeChanged?.((t) =>
          applyTheme(t as "dark" | "light")
        );
        return () => unsub?.();
      } else {
        const mq = window.matchMedia("(prefers-color-scheme: dark)");
        applyTheme(mq.matches ? "dark" : "light");
        const handler = (e: MediaQueryListEvent) =>
          applyTheme(e.matches ? "dark" : "light");
        mq.addEventListener("change", handler);
        return () => mq.removeEventListener("change", handler);
      }
    } else {
      applyTheme(theme);
    }
  }, [theme, setResolvedTheme]);

  return (
    <>
      {connected && authenticated ? <MainLayout /> : <ConnectScreen />}

      {kickReason && (
        <Notification
          type="kicked"
          message={kickReason}
          onDismiss={() => setKickReason(null)}
        />
      )}
      {banReason && (
        <Notification
          type="banned"
          message={banReason}
          onDismiss={() => setBanReason(null)}
        />
      )}
    </>
  );
}
