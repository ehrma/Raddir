import { useState } from "react";
import { AudioSettings } from "./AudioSettings";
import { KeybindSettings } from "./KeybindSettings";
import { IdentitySettings } from "./IdentitySettings";
import { AppearanceSettings } from "./AppearanceSettings";
import { ProfileSettings } from "./ProfileSettings";
import { X, Volume2, Keyboard, Shield, Palette, User } from "lucide-react";
import { cn } from "../../lib/cn";

type Tab = "profile" | "audio" | "keybinds" | "identity" | "appearance";

const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "profile", label: "Profile", icon: <User className="w-4 h-4" /> },
  { id: "audio", label: "Audio", icon: <Volume2 className="w-4 h-4" /> },
  { id: "keybinds", label: "Keybinds", icon: <Keyboard className="w-4 h-4" /> },
  { id: "appearance", label: "Appearance", icon: <Palette className="w-4 h-4" /> },
  { id: "identity", label: "Identity", icon: <Shield className="w-4 h-4" /> },
];

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<Tab>("profile");

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[calc(100vh-2rem)] bg-surface-900 rounded-xl border border-surface-700 shadow-2xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-800">
          <h2 className="text-sm font-semibold text-surface-200">Settings</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-surface-400 hover:text-surface-200 hover:bg-surface-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Tabs */}
          <div className="w-40 border-r border-surface-800 p-2 space-y-0.5">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors",
                  activeTab === tab.id
                    ? "bg-accent/20 text-accent"
                    : "text-surface-400 hover:text-surface-200 hover:bg-surface-800"
                )}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 p-5 min-h-0 overflow-y-auto">
            {activeTab === "profile" && <ProfileSettings />}
            {activeTab === "audio" && <AudioSettings />}
            {activeTab === "keybinds" && <KeybindSettings />}
            {activeTab === "appearance" && <AppearanceSettings />}
            {activeTab === "identity" && <IdentitySettings />}
          </div>
        </div>
      </div>
    </div>
  );
}
