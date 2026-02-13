import { useState, useEffect, useRef } from "react";
import { useVideoStore } from "../stores/videoStore";
import { useServerStore } from "../stores/serverStore";
import { Camera, Monitor, Maximize2, Minimize2 } from "lucide-react";
import { cn } from "../lib/cn";

function VideoTile({
  stream,
  label,
  isScreen,
  isLocal,
  isMaximized,
  onToggleMaximize,
}: {
  stream: MediaStream;
  label: string;
  isScreen: boolean;
  isLocal: boolean;
  isMaximized: boolean;
  onToggleMaximize: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
    return () => {
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [stream]);

  return (
    <div
      className={cn(
        "relative rounded-lg overflow-hidden bg-surface-950 border border-surface-700 group/tile cursor-pointer",
        !isMaximized && isScreen ? "col-span-2 row-span-2" : ""
      )}
      onDoubleClick={onToggleMaximize}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        className={cn(
          "w-full h-full object-contain",
          isLocal && !isScreen && "scale-x-[-1]"
        )}
      />
      <div className="absolute bottom-0 left-0 right-0 flex items-center gap-1.5 px-2 py-1.5 bg-gradient-to-t from-black/70 to-transparent">
        {isScreen ? (
          <Monitor className="w-3 h-3 text-surface-300 flex-shrink-0" />
        ) : (
          <Camera className="w-3 h-3 text-surface-300 flex-shrink-0" />
        )}
        <span className="text-[11px] text-surface-200 truncate font-medium">
          {label}
          {isLocal && <span className="text-surface-400 ml-1">(you)</span>}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onToggleMaximize(); }}
          className="ml-auto p-0.5 rounded text-surface-400 hover:text-surface-100 opacity-0 group-hover/tile:opacity-100 transition-opacity"
          title={isMaximized ? "Minimize" : "Maximize"}
        >
          {isMaximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
}

export function VideoGrid() {
  const {
    webcamActive,
    screenShareActive,
    localWebcamStream,
    localScreenStream,
    remoteVideos,
  } = useVideoStore();
  const { userId, members } = useServerStore();
  const [maximizedKey, setMaximizedKey] = useState<string | null>(null);

  const hasAnyVideo =
    webcamActive || screenShareActive || remoteVideos.size > 0;

  // Clear maximized state when all video stops — must be before early return to keep hook order stable
  useEffect(() => {
    if (!hasAnyVideo && maximizedKey) {
      setMaximizedKey(null);
    }
  }, [hasAnyVideo, maximizedKey]);

  if (!hasAnyVideo) return null;

  const nickname = userId ? members.get(userId)?.nickname ?? "You" : "You";

  // Build tile list
  const tiles: Array<{
    key: string;
    stream: MediaStream;
    label: string;
    isScreen: boolean;
    isLocal: boolean;
  }> = [];

  // Local screen share first (largest)
  if (screenShareActive && localScreenStream) {
    tiles.push({
      key: "local:screen",
      stream: localScreenStream,
      label: nickname,
      isScreen: true,
      isLocal: true,
    });
  }

  // Remote screen shares
  for (const [key, video] of remoteVideos) {
    if (video.mediaType !== "screen") continue;
    const uid = key.split(":")[0];
    const member = members.get(uid);
    tiles.push({
      key,
      stream: video.stream,
      label: member?.nickname ?? uid.slice(0, 8),
      isScreen: true,
      isLocal: false,
    });
  }

  // Local webcam
  if (webcamActive && localWebcamStream) {
    tiles.push({
      key: "local:webcam",
      stream: localWebcamStream,
      label: nickname,
      isScreen: false,
      isLocal: true,
    });
  }

  // Remote webcams
  for (const [key, video] of remoteVideos) {
    if (video.mediaType !== "webcam") continue;
    const uid = key.split(":")[0];
    const member = members.get(uid);
    tiles.push({
      key,
      stream: video.stream,
      label: member?.nickname ?? uid.slice(0, 8),
      isScreen: false,
      isLocal: false,
    });
  }

  // Determine grid columns based on tile count
  const hasScreenShare = tiles.some((t) => t.isScreen);
  const gridCols = hasScreenShare
    ? "grid-cols-2"
    : tiles.length <= 1
      ? "grid-cols-1"
      : tiles.length <= 4
        ? "grid-cols-2"
        : "grid-cols-3";

  const maximizedTile = maximizedKey ? tiles.find((t) => t.key === maximizedKey) ?? null : null;

  return (
    <>
      <div className="border-b border-surface-800 bg-surface-950/50 p-2">
        <div
          className={cn(
            "grid gap-2 auto-rows-fr",
            gridCols
          )}
          style={{ maxHeight: "40vh" }}
        >
          {tiles.map((tile) => (
            <VideoTile
              key={tile.key}
              stream={tile.stream}
              label={tile.label}
              isScreen={tile.isScreen}
              isLocal={tile.isLocal}
              isMaximized={false}
              onToggleMaximize={() => setMaximizedKey(tile.key)}
            />
          ))}
        </div>
      </div>

      {maximizedTile && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-6"
          onClick={() => setMaximizedKey(null)}
        >
          <div
            className="relative w-full h-full"
            onClick={(e) => e.stopPropagation()}
          >
            <video
              ref={(el) => { if (el) el.srcObject = maximizedTile.stream; }}
              autoPlay
              playsInline
              muted={maximizedTile.isLocal}
              className={cn(
                "absolute inset-0 w-full h-full object-contain",
                maximizedTile.isLocal && !maximizedTile.isScreen && "scale-x-[-1]"
              )}
            />
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black/60 backdrop-blur-sm">
              {maximizedTile.isScreen ? (
                <Monitor className="w-3.5 h-3.5 text-surface-300" />
              ) : (
                <Camera className="w-3.5 h-3.5 text-surface-300" />
              )}
              <span className="text-xs text-surface-200 font-medium">
                {maximizedTile.label}
                {maximizedTile.isLocal && <span className="text-surface-400 ml-1">(you)</span>}
              </span>
              <button
                onClick={() => setMaximizedKey(null)}
                className="ml-2 p-0.5 rounded text-surface-400 hover:text-surface-100 transition-colors"
                title="Minimize"
              >
                <Minimize2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
