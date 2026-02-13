import { useState } from "react";
import { useServerStore } from "../stores/serverStore";
import { useVoiceStore } from "../stores/voiceStore";
import { useVerificationStore } from "../stores/verificationStore";
import { Mic, MicOff, VolumeX, Volume2, ShieldCheck } from "lucide-react";
import { cn } from "../lib/cn";
import { VolumeSlider } from "./VolumeSlider";
import { VerifyUserDialog } from "./VerifyUserDialog";
import { getApiBase } from "../lib/api-base";

export function UserList() {
  const { currentChannelId, members, userId } = useServerStore();
  const { speakingUsers } = useVoiceStore();
  const { isVerified } = useVerificationStore();

  const channelMembers = Array.from(members.values()).filter(
    (m) => m.channelId === currentChannelId
  );

  if (channelMembers.length === 0) {
    return (
      <div className="p-3">
        <p className="text-xs text-surface-500">No users in channel</p>
      </div>
    );
  }

  return (
    <div className="p-2">
      <h3 className="px-2 py-1 text-xs font-semibold text-surface-500 uppercase tracking-wider">
        In Channel — {channelMembers.length}
      </h3>
      <div className="mt-1 space-y-0.5">
        {channelMembers.map((member) => {
          const isSpeaking = speakingUsers.has(member.userId);
          const isMe = member.userId === userId;

          return (
            <div
              key={member.userId}
              className={cn(
                "flex items-center gap-2 px-2 py-1.5 rounded-md group",
                isSpeaking && "bg-accent/10"
              )}
            >
              {member.avatarUrl ? (
                <img
                  src={`${getApiBase()}${member.avatarUrl}`}
                  alt=""
                  className={cn(
                    "w-6 h-6 rounded-full object-cover flex-shrink-0",
                    isSpeaking && "ring-2 ring-green-400 shadow-[0_0_8px_rgba(74,222,128,0.6)]"
                  )}
                />
              ) : (
                <div
                  className={cn(
                    "w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0",
                    isSpeaking
                      ? "bg-green-500/30 text-green-400 ring-2 ring-green-400 shadow-[0_0_8px_rgba(74,222,128,0.6)]"
                      : "bg-surface-700 text-surface-300"
                  )}
                >
                  {member.nickname.charAt(0).toUpperCase()}
                </div>
              )}

              <span
                className={cn(
                  "text-sm truncate flex-1",
                  isMe ? "text-accent" : "text-surface-300"
                )}
              >
                {member.nickname}
                {isMe && <span className="text-surface-500 text-xs ml-1">(you)</span>}
              </span>

              {member.publicKey && isVerified(member.publicKey) && (
                <ShieldCheck className="w-3 h-3 text-green-400 flex-shrink-0" />
              )}

              <div className="flex items-center gap-1">
                {member.isMuted && (
                  <MicOff className="w-3 h-3 text-red-400" />
                )}
                {member.isDeafened && (
                  <VolumeX className="w-3 h-3 text-red-400" />
                )}
              </div>

              {!isMe && (
                <div className="hidden group-hover:block">
                  <VolumeSlider userId={member.userId} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
