import { useState, useEffect } from "react";
import { X, Monitor, AppWindow } from "lucide-react";
import { cn } from "../lib/cn";

interface DesktopSource {
  id: string;
  name: string;
  thumbnailDataUrl: string;
  display_id: string;
}

export function ScreenSourcePicker({
  onSelect,
  onClose,
}: {
  onSelect: (sourceId: string, includeAudio: boolean) => void;
  onClose: () => void;
}) {
  const [sources, setSources] = useState<DesktopSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [includeAudio, setIncludeAudio] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchSources() {
      try {
        const result = await window.raddir?.getDesktopSources();
        if (!cancelled && result) {
          setSources(result);
        }
      } catch (err) {
        console.error("[screen-picker] Failed to get sources:", err);
      }
      if (!cancelled) setLoading(false);
    }

    fetchSources();
    return () => { cancelled = true; };
  }, []);

  const screens = sources.filter((s) => s.id.startsWith("screen:"));
  const windows = sources.filter((s) => s.id.startsWith("window:"));

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="w-full max-w-3xl max-h-[80vh] bg-surface-900 rounded-xl border border-surface-700 shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-800">
          <h2 className="text-sm font-semibold text-surface-200">
            Share your screen
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-surface-400 hover:text-surface-200 hover:bg-surface-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="rounded-lg border border-surface-700 bg-surface-800/50 p-3">
            <label className="flex items-center justify-between gap-3 cursor-pointer select-none">
              <div>
                <p className="text-xs font-medium text-surface-200">Share system audio</p>
                <p className="text-[10px] text-surface-400 mt-0.5">
                  Include desktop sound in the screen stream (encrypted with E2EE).
                </p>
              </div>
              <button
                type="button"
                aria-pressed={includeAudio}
                onClick={() => setIncludeAudio((v) => !v)}
                className={cn(
                  "w-10 h-5 rounded-full transition-colors flex-shrink-0",
                  includeAudio ? "bg-accent" : "bg-surface-700"
                )}
              >
                <div
                  className={cn(
                    "w-4 h-4 rounded-full bg-white transition-transform",
                    includeAudio ? "translate-x-5" : "translate-x-0.5"
                  )}
                />
              </button>
            </label>
          </div>

          {loading && (
            <p className="text-sm text-surface-400 text-center py-8">
              Loading sources...
            </p>
          )}

          {!loading && sources.length === 0 && (
            <p className="text-sm text-surface-400 text-center py-8">
              No sources available
            </p>
          )}

          {screens.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-surface-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Monitor className="w-3.5 h-3.5" /> Screens
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {screens.map((source) => (
                  <SourceTile
                    key={source.id}
                    source={source}
                    onSelect={onSelect}
                    includeAudio={includeAudio}
                  />
                ))}
              </div>
            </div>
          )}

          {windows.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-surface-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <AppWindow className="w-3.5 h-3.5" /> Windows
              </h3>
              <div className="grid grid-cols-3 gap-3">
                {windows.map((source) => (
                  <SourceTile
                    key={source.id}
                    source={source}
                    onSelect={onSelect}
                    includeAudio={includeAudio}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SourceTile({
  source,
  onSelect,
  includeAudio,
}: {
  source: DesktopSource;
  onSelect: (sourceId: string, includeAudio: boolean) => void;
  includeAudio: boolean;
}) {
  return (
    <button
      onClick={() => onSelect(source.id, includeAudio)}
      className="group rounded-lg border border-surface-700 bg-surface-800 overflow-hidden hover:border-accent transition-colors text-left"
    >
      <div className="aspect-video bg-surface-950 flex items-center justify-center overflow-hidden">
        <img
          src={source.thumbnailDataUrl}
          alt={source.name}
          className="w-full h-full object-contain"
        />
      </div>
      <div className="px-2 py-1.5">
        <p className="text-xs text-surface-300 truncate group-hover:text-accent transition-colors">
          {source.name}
        </p>
      </div>
    </button>
  );
}
