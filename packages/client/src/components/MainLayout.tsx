import { ChannelTree } from "./ChannelTree";
import { UserList } from "./UserList";
import { VoiceControls } from "./VoiceControls";
import { TextChat } from "./TextChat";
import { useServerStore } from "../stores/serverStore";
import { useAudio } from "../hooks/useAudio";

export function MainLayout() {
  const { currentChannelId, channels } = useServerStore();
  const currentChannel = channels.find((c) => c.id === currentChannelId);
  useAudio();

  return (
    <div className="flex h-screen bg-surface-950 text-surface-100">
      {/* Sidebar: Channel tree + voice controls */}
      <div className="w-64 flex flex-col bg-surface-900 border-r border-surface-800">
        <div className="p-3 border-b border-surface-800">
          <h2 className="text-sm font-semibold text-surface-200 truncate">
            Raddir Server
          </h2>
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
