import { useState, useEffect } from "react";
import { useVideoStore } from "../stores/videoStore";
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
  onSelect: (sourceId: string) => void;
  onClose: () => void;
}) {
  const [sources, setSources] = useState<DesktopSource[]>([]);
  const [loading, setLoading] = useState(true);

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
}: {
  source: DesktopSource;
  onSelect: (sourceId: string) => void;
}) {
  return (
    <button
      onClick={() => onSelect(source.id)}
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
