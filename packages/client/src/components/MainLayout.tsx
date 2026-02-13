import { ChannelTree } from "./ChannelTree";
import { UserList } from "./UserList";
import { VoiceControls } from "./VoiceControls";
import { TextChat } from "./TextChat";
import { useServerStore } from "../stores/serverStore";
import { useAudio } from "../hooks/useAudio";
import { getApiBase } from "../lib/api-base";

export function MainLayout() {
  const { currentChannelId, channels, serverName, serverDescription, serverIconUrl } = useServerStore();
  const currentChannel = channels.find((c) => c.id === currentChannelId);
  useAudio();

  const iconSrc = serverIconUrl ? `${getApiBase()}${serverIconUrl}` : null;

  return (
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
            </div>

            <div className="flex flex-1 overflow-hidden">
              <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
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
  );
}
