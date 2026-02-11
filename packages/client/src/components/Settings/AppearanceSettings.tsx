import { useThemeStore, type ThemeMode } from "../../stores/themeStore";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "../../lib/cn";

const themes: { id: ThemeMode; label: string; icon: React.ReactNode; description: string }[] = [
  { id: "system", label: "System", icon: <Monitor className="w-5 h-5" />, description: "Follow your OS setting" },
  { id: "dark", label: "Dark", icon: <Moon className="w-5 h-5" />, description: "Always use dark theme" },
  { id: "light", label: "Light", icon: <Sun className="w-5 h-5" />, description: "Always use light theme" },
];

export function AppearanceSettings() {
  const { mode, setMode } = useThemeStore();

  return (
    <div className="space-y-5">
      <h3 className="text-sm font-semibold text-surface-200">Appearance</h3>

      <div className="space-y-2">
        <p className="text-xs text-surface-400 mb-3">Choose how Raddir looks to you.</p>

        <div className="grid grid-cols-3 gap-3">
          {themes.map((theme) => (
            <button
              key={theme.id}
              onClick={() => setMode(theme.id)}
              className={cn(
                "flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all",
                mode === theme.id
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-surface-700 bg-surface-800/50 text-surface-400 hover:border-surface-600 hover:text-surface-200"
              )}
            >
              {theme.icon}
              <span className="text-xs font-medium">{theme.label}</span>
            </button>
          ))}
        </div>

        <div className="mt-4 p-3 bg-surface-800/30 rounded-lg border border-surface-700/50">
          <p className="text-[10px] text-surface-500 leading-relaxed">
            {themes.find((t) => t.id === mode)?.description}
          </p>
        </div>
      </div>
    </div>
  );
}
