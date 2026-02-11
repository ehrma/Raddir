import { Wifi } from "lucide-react";

export function ReconnectOverlay() {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-40">
      <div className="flex flex-col items-center gap-3 text-surface-300">
        <Wifi className="w-8 h-8 animate-pulse text-accent" />
        <p className="text-sm font-medium">Reconnecting...</p>
        <p className="text-xs text-surface-500">Attempting to restore your connection</p>
      </div>
    </div>
  );
}
