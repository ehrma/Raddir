import { useState } from "react";
import { ChannelTree } from "./ChannelTree";
import { UserList } from "./UserList";
import { VoiceControls } from "./VoiceControls";
import { TextChat } from "./TextChat";
import { VideoGrid } from "./VideoGrid";
import { ScreenSourcePicker } from "./ScreenSourcePicker";
import { useServerStore } from "../stores/serverStore";
import { useVideoStore } from "../stores/videoStore";
import { useAudio } from "../hooks/useAudio";
import { useVideo } from "../hooks/useVideo";
import { usePermissions } from "../hooks/usePermissions";
import { getApiBase } from "../lib/api-base";
import { Camera, CameraOff, Monitor, MonitorOff } from "lucide-react";
import { cn } from "../lib/cn";

export function MainLayout() {
  const [showWebcamConfirm, setShowWebcamConfirm] = useState(false);
  const { currentChannelId, channels, serverName, serverDescription, serverIconUrl } = useServerStore();
  const currentChannel = channels.find((c) => c.id === currentChannelId);
  useAudio();
  const { webcamActive, screenShareActive, showSourcePicker, toggleWebcam, toggleScreenShare, startScreenShareWithSource } = useVideo();
  const closeSourcePicker = () => useVideoStore.getState().setShowSourcePicker(false);
  const { can } = usePermissions();

  const handleWebcamClick = () => {
    if (webcamActive) {
      toggleWebcam();
      return;
    }
    setShowWebcamConfirm(true);
  };

  const confirmStartWebcam = () => {
    setShowWebcamConfirm(false);
    toggleWebcam();
  };

  const iconSrc = serverIconUrl ? `${getApiBase()}${serverIconUrl}` : null;

  return (
    <>
    <div className="flex h-screen bg-surface-950 text-surface-100">
      {/* Sidebar: Channel tree + voice controls */}
      <div className="w-64 flex flex-col bg-surface-900 border-r border-surface-800">
        <div className="flex items-center gap-2.5 p-3 border-b border-surface-800">
          {iconSrc ? (
            <img
              src={iconSrc}
              alt="Server icon"
              className="w-9 h-9 rounded-lg object-cover flex-shrink-0"
            />
          ) : (
            <div className="w-9 h-9 rounded-lg bg-accent/20 flex items-center justify-center text-sm font-bold text-accent flex-shrink-0">
              {(serverName ?? "R").charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-surface-200 truncate">
              {serverName ?? "Raddir Server"}
            </h2>
            {serverDescription && (
              <p className="text-[10px] text-surface-500 truncate">{serverDescription}</p>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <ChannelTree />
        </div>

        <VoiceControls />
      </div>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
        {currentChannel ? (
          <>
            <div className="h-12 flex items-center px-4 border-b border-surface-800 bg-surface-900/50">
              <span className="text-sm font-medium text-surface-200">
                {currentChannel.name}
              </span>
              {currentChannel.description && (
                <span className="ml-3 text-xs text-surface-500 truncate">
                  {currentChannel.description}
                </span>
              )}
              <div className="ml-auto flex items-center gap-1">
                <span title={!can("video") ? "You do not have sufficient rights to use video" : webcamActive ? "Stop Camera" : "Start Camera"}>
                  <button
                    onClick={can("video") ? handleWebcamClick : undefined}
                    disabled={!can("video")}
                    className={cn(
                      "p-1.5 rounded-md transition-colors",
                      !can("video")
                        ? "text-surface-600 cursor-not-allowed opacity-50 pointer-events-none"
                        : webcamActive
                          ? "bg-green-500/20 text-green-400 hover:bg-green-500/30"
                          : "text-surface-400 hover:text-surface-200 hover:bg-surface-800"
                    )}
                  >
                    {webcamActive ? <Camera className="w-4 h-4" /> : <CameraOff className="w-4 h-4" />}
                  </button>
                </span>
                <span title={!can("screenShare") ? "You do not have sufficient rights to share your screen" : screenShareActive ? "Stop Screen Share" : "Share Screen"}>
                  <button
                    onClick={can("screenShare") ? toggleScreenShare : undefined}
                    disabled={!can("screenShare")}
                    className={cn(
                      "p-1.5 rounded-md transition-colors",
                      !can("screenShare")
                        ? "text-surface-600 cursor-not-allowed opacity-50 pointer-events-none"
                        : screenShareActive
                          ? "bg-green-500/20 text-green-400 hover:bg-green-500/30"
                          : "text-surface-400 hover:text-surface-200 hover:bg-surface-800"
                    )}
                  >
                    {screenShareActive ? <Monitor className="w-4 h-4" /> : <MonitorOff className="w-4 h-4" />}
                  </button>
                </span>
              </div>
            </div>

            <div className="flex flex-1 overflow-hidden">
              <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                <VideoGrid />
                <TextChat />
              </div>
              <div className="w-56 border-l border-surface-800 bg-surface-900/30">
                <UserList />
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-surface-500 text-sm">
              Select a channel to join
            </p>
          </div>
        )}
      </div>
    </div>
    {showSourcePicker && (
      <ScreenSourcePicker
        onSelect={startScreenShareWithSource}
        onClose={closeSourcePicker}
      />
    )}
    {showWebcamConfirm && (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowWebcamConfirm(false)}>
        <div
          className="w-full max-w-sm bg-surface-900 rounded-xl border border-surface-700 shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-4 py-3 border-b border-surface-800">
            <h2 className="text-sm font-semibold text-surface-200">Start webcam?</h2>
          </div>
          <div className="p-4 space-y-4">
            <p className="text-xs text-surface-400 leading-relaxed">
              Do you really want to share your webcam in this channel?
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowWebcamConfirm(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-surface-300 bg-surface-800 hover:bg-surface-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmStartWebcam}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-green-600 hover:bg-green-500 transition-colors"
              >
                Share webcam
              </button>
            </div>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
