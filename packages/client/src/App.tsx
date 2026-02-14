import { useEffect, useState } from "react";
import { useServerStore } from "./stores/serverStore";
import { useSettingsStore } from "./stores/settingsStore";
import { ConnectScreen } from "./components/ConnectScreen";
import { MainLayout } from "./components/MainLayout";
import { ReconnectOverlay } from "./components/ReconnectOverlay";
import { Notification } from "./components/Notification";
import { useConnection } from "./hooks/useConnection";
import { loadSettings } from "./lib/settings-persistence";
import type { AppUpdateStatus } from "./types/electron";

export function App() {
  const { connected, authenticated } = useServerStore();
  const theme = useSettingsStore((s) => s.theme);
  const setResolvedTheme = useSettingsStore((s) => s.setResolvedTheme);
  const { kickReason, banReason, setKickReason, setBanReason } = useConnection();
  const [downloadedVersion, setDownloadedVersion] = useState<string | null>(null);

  // Load persisted settings on mount
  useEffect(() => {
    loadSettings().catch(() => {});
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

  // App updates: notify when update is downloaded and restart is required
  useEffect(() => {
    if (!window.raddir?.onAppUpdateStatus) return;

    const handleStatus = (status: AppUpdateStatus) => {
      if (status.state === "downloaded") {
        setDownloadedVersion(status.version);
      }
    };

    const unsub = window.raddir.onAppUpdateStatus(handleStatus);

    window.raddir.getAppUpdateStatus?.()
      .then((status) => {
        if (status.state === "downloaded") {
          setDownloadedVersion(status.version);
        }
      })
      .catch(() => {});

    return () => unsub?.();
  }, []);

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

      {downloadedVersion && (
        <Notification
          type="info"
          persist
          message={`Update v${downloadedVersion} has been downloaded. Restart Raddir to apply it.`}
          actionLabel="Restart now"
          onAction={() => {
            window.raddir?.installAppUpdateNow?.().catch(() => {});
          }}
          onDismiss={() => setDownloadedVersion(null)}
        />
      )}
    </>
  );
}
