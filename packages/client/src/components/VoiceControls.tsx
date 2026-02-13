import { useState } from "react";
import { useVoiceStore } from "../stores/voiceStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useConnection } from "../hooks/useConnection";
import { usePermissions } from "../hooks/usePermissions";
import { Mic, MicOff, Headphones, HeadphoneOff, LogOut, Shield, ShieldOff, Settings, ShieldCheck } from "lucide-react";
import { cn } from "../lib/cn";
import { SettingsPanel } from "./Settings/SettingsPanel";
import { AdminPanel } from "./AdminPanel";

export function VoiceControls() {
  const { isMuted, isDeafened, toggleMute, toggleDeafen, e2eeActive, keyEpoch } = useVoiceStore();
  const nickname = useSettingsStore((s) => s.nickname);
  const { disconnect } = useConnection();
  const { isAdmin } = usePermissions();
  const [showSettings, setShowSettings] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);

  return (
    <>
      <div className="border-t border-surface-800 bg-surface-900">
        {/* User info */}
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="w-7 h-7 rounded-full bg-accent/20 flex items-center justify-center text-xs font-medium text-accent flex-shrink-0">
            {nickname?.charAt(0).toUpperCase() ?? "?"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-surface-200 truncate">
              {nickname}
            </p>
            <p className={cn("text-[10px] flex items-center gap-1", e2eeActive ? "text-green-500" : "text-yellow-500")}>
              {e2eeActive ? <Shield className="w-2.5 h-2.5" /> : <ShieldOff className="w-2.5 h-2.5" />}
              {e2eeActive ? `E2EE Active (epoch ${keyEpoch})` : "E2EE Inactive"}
            </p>
          </div>
          {isAdmin && (
            <button
              onClick={() => setShowAdmin(true)}
              className="p-1 rounded-md text-surface-500 hover:text-accent hover:bg-surface-800 transition-colors"
              title="Server Admin"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => setShowSettings(true)}
            className="p-1 rounded-md text-surface-500 hover:text-surface-200 hover:bg-surface-800 transition-colors"
            title="Settings"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Control buttons */}
        <div className="flex items-center gap-1 px-2 pb-2">
          <button
            onClick={toggleMute}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors",
              isMuted
                ? "bg-red-500/20 text-red-400 hover:bg-red-500/30"
                : "bg-surface-800 text-surface-300 hover:bg-surface-700"
            )}
            title={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
            {isMuted ? "Muted" : "Mic"}
          </button>

          <button
            onClick={toggleDeafen}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors",
              isDeafened
                ? "bg-red-500/20 text-red-400 hover:bg-red-500/30"
                : "bg-surface-800 text-surface-300 hover:bg-surface-700"
            )}
            title={isDeafened ? "Undeafen" : "Deafen"}
          >
            {isDeafened ? (
              <HeadphoneOff className="w-3.5 h-3.5" />
            ) : (
              <Headphones className="w-3.5 h-3.5" />
            )}
            {isDeafened ? "Deaf" : "Audio"}
          </button>

          <button
            onClick={disconnect}
            className="p-1.5 rounded-md bg-surface-800 text-surface-400 hover:bg-red-500/20 hover:text-red-400 transition-colors"
            title="Disconnect"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      {showAdmin && <AdminPanel onClose={() => setShowAdmin(false)} />}
    </>
  );
}
