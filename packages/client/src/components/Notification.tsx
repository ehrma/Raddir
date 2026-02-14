import { useEffect } from "react";
import { AlertTriangle, X, Ban } from "lucide-react";
import { cn } from "../lib/cn";

interface NotificationProps {
  type: "kicked" | "banned" | "error" | "info";
  message: string;
  onDismiss: () => void;
  persist?: boolean;
  actionLabel?: string;
  onAction?: () => void;
}

export function Notification({ type, message, onDismiss, persist = false, actionLabel, onAction }: NotificationProps) {
  useEffect(() => {
    if (type === "info" && !persist) {
      const timer = setTimeout(onDismiss, 5000);
      return () => clearTimeout(timer);
    }
  }, [type, onDismiss, persist]);

  return (
    <div className="fixed top-4 right-4 z-50 animate-in slide-in-from-top">
      <div
        className={cn(
          "flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg max-w-sm",
          type === "kicked" && "bg-orange-500/10 border-orange-500/30 text-orange-300",
          type === "banned" && "bg-red-500/10 border-red-500/30 text-red-300",
          type === "error" && "bg-red-500/10 border-red-500/30 text-red-300",
          type === "info" && "bg-accent/10 border-accent/30 text-accent"
        )}
      >
        {(type === "kicked" || type === "error") && <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
        {type === "banned" && <Ban className="w-4 h-4 flex-shrink-0" />}
        <p className="text-sm flex-1">{message}</p>
        {actionLabel && onAction && (
          <button
            onClick={onAction}
            className="px-2 py-1 text-xs font-medium rounded bg-white/10 hover:bg-white/20 transition-colors"
          >
            {actionLabel}
          </button>
        )}
        <button onClick={onDismiss} className="p-0.5 rounded hover:bg-white/10 transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
