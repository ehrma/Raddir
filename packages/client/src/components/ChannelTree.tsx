import { useEffect, useMemo, useState, useCallback } from "react";
import { useServerStore } from "../stores/serverStore";
import { useVoiceStore } from "../stores/voiceStore";
import { useVerificationStore } from "../stores/verificationStore";
import { getSignalingClient } from "../hooks/useConnection";
import { Volume2, ChevronDown, Lock, MicOff, ShieldCheck, Shield, X, Copy } from "lucide-react";
import { cn } from "../lib/cn";
import { VerifyUserDialog } from "./VerifyUserDialog";
import { getStoredIdentityPublicKey, computeFingerprint } from "../lib/e2ee/identity";
import { getUserRoleColor } from "../lib/role-color";
import type { Channel, SessionInfo } from "@raddir/shared";

interface ChannelNode extends Channel {
  children: ChannelNode[];
  userCount: number;
  users: SessionInfo[];
}

function buildTree(channels: Channel[], members: Map<string, SessionInfo>): ChannelNode[] {
  const nodeMap = new Map<string, ChannelNode>();

  for (const ch of channels) {
    nodeMap.set(ch.id, { ...ch, children: [], userCount: 0, users: [] });
  }

  // Count users per channel and collect them
  for (const member of members.values()) {
    if (member.channelId) {
      const node = nodeMap.get(member.channelId);
      if (node) {
        node.userCount++;
        node.users.push(member);
      }
    }
  }

  const roots: ChannelNode[] = [];
  for (const node of nodeMap.values()) {
    if (node.parentId && nodeMap.has(node.parentId)) {
      nodeMap.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  roots.sort((a, b) => a.position - b.position);
  for (const node of nodeMap.values()) {
    node.children.sort((a, b) => a.position - b.position);
  }

  return roots;
}

export function ChannelTree() {
  const { channels, members, currentChannelId } = useServerStore();

  const tree = useMemo(
    () => buildTree(channels, members),
    [channels, members]
  );

  return (
    <div className="py-2">
      {tree.map((node) => (
        <ChannelNode key={node.id} node={node} currentChannelId={currentChannelId} depth={0} />
      ))}
    </div>
  );
}

function ChannelNode({
  node,
  currentChannelId,
  depth,
}: {
  node: ChannelNode;
  currentChannelId: string | null;
  depth: number;
}) {
  const isActive = node.id === currentChannelId;
  const hasChildren = node.children.length > 0;

  const [dragOver, setDragOver] = useState(false);

  const handleClick = () => {
    const client = getSignalingClient();
    if (!client) return;

    if (isActive) {
      client.send({ type: "leave-channel" });
      useServerStore.getState().setCurrentChannel(null);
    } else {
      // Don't set currentChannelId here — wait for the joined-channel response
      // to avoid a race condition where useAudio misses the message
      client.send({ type: "join-channel", channelId: node.id });
    }
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("application/x-raddir-userid")) {
      e.preventDefault();
      setDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback(() => setDragOver(false), []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    setDragOver(false);
    const userId = e.dataTransfer.getData("application/x-raddir-userid");
    if (!userId) return;
    const client = getSignalingClient();
    if (!client) return;
    client.send({ type: "move-user", userId, channelId: node.id });
  }, [node.id]);

  return (
    <div>
      <button
        onClick={handleClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "w-full flex items-center gap-1.5 px-2 py-1 text-left text-sm transition-colors",
          dragOver
            ? "bg-accent/30 text-accent ring-1 ring-accent"
            : isActive
              ? "bg-accent/20 text-accent"
              : "text-surface-400 hover:text-surface-200 hover:bg-surface-800/50"
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {hasChildren && (
          <ChevronDown className="w-3 h-3 flex-shrink-0 text-surface-500" />
        )}
        <Volume2 className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="truncate flex-1">{node.name}</span>
        {node.userCount > 0 && (
          <span className="text-xs text-surface-500">{node.userCount}</span>
        )}
        {node.joinPower > 0 && (
          <Lock className="w-3 h-3 text-surface-600" />
        )}
      </button>

      {/* Inline users in this channel */}
      {node.users.length > 0 && (
        <div className="space-y-px" style={{ paddingLeft: `${depth * 16 + 24}px` }}>
          {node.users.map((user) => (
            <ChannelUserEntry key={user.userId} user={user} />
          ))}
        </div>
      )}

      {hasChildren &&
        node.children.map((child) => (
          <ChannelNode
            key={child.id}
            node={child}
            currentChannelId={currentChannelId}
            depth={depth + 1}
          />
        ))}
    </div>
  );
}

function ChannelUserEntry({ user }: { user: SessionInfo }) {
  const speakingUsers = useVoiceStore((s) => s.speakingUsers);
  const isSpeaking = speakingUsers.has(user.userId);
  const myUserId = useServerStore((s) => s.userId);
  const isMe = user.userId === myUserId;
  const isVerified = useVerificationStore((s) => !isMe && user.publicKey ? s.isVerified(user.publicKey) : false);
  const [showVerify, setShowVerify] = useState(false);
  const [showMyIdentity, setShowMyIdentity] = useState(false);
  const roleColor = getUserRoleColor(user.userId);

  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.dataTransfer.setData("application/x-raddir-userid", user.userId);
    e.dataTransfer.effectAllowed = "move";
  }, [user.userId]);

  return (
    <>
      <button
        draggable
        onDragStart={handleDragStart}
        onClick={(e) => { e.stopPropagation(); isMe ? setShowMyIdentity(true) : setShowVerify(true); }}
        className={cn(
          "w-full flex items-center gap-1.5 py-0.5 text-xs transition-colors text-left cursor-grab active:cursor-grabbing",
          isMe ? "text-accent" : "text-surface-400 hover:text-surface-200"
        )}
      >
        <div
          className={cn(
            "w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-medium flex-shrink-0 transition-all",
            isSpeaking
              ? "bg-accent/30 text-accent ring-1 ring-accent"
              : isMe
                ? "bg-accent/20 text-accent"
                : "bg-surface-700 text-surface-400"
          )}
        >
          {user.nickname.charAt(0).toUpperCase()}
        </div>
        <span className="truncate" style={roleColor ? { color: roleColor } : undefined}>{user.nickname}</span>
        {isMe && <span className="text-[9px] text-surface-500 flex-shrink-0">(you)</span>}
        {isVerified && <ShieldCheck className="w-2.5 h-2.5 text-green-400 flex-shrink-0" />}
        {user.isMuted && <MicOff className="w-2.5 h-2.5 text-surface-600 flex-shrink-0" />}
      </button>
      {showVerify && !isMe && <VerifyUserDialog user={user} onClose={() => setShowVerify(false)} />}
      {showMyIdentity && isMe && <MyIdentityDialog onClose={() => setShowMyIdentity(false)} />}
    </>
  );
}

function MyIdentityDialog({ onClose }: { onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const fingerprint = publicKey ? computeFingerprint(publicKey) : "";

  useEffect(() => {
    getStoredIdentityPublicKey().then(setPublicKey);
  }, []);

  const handleCopy = () => {
    if (fingerprint) {
      navigator.clipboard.writeText(fingerprint);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-xs bg-surface-900 rounded-xl border border-surface-700 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-800">
          <h2 className="text-sm font-semibold text-surface-200 flex items-center gap-2">
            <Shield className="w-4 h-4 text-accent" />
            Your Identity
          </h2>
          <button onClick={onClose} className="p-1 rounded-md text-surface-400 hover:text-surface-200 hover:bg-surface-800 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div className="text-center">
            <p className="text-[10px] text-surface-500 mb-2">Your Fingerprint</p>
            <div className="inline-flex items-center gap-2 px-4 py-2.5 bg-surface-800 rounded-lg border border-surface-700">
              <span className="text-sm font-mono font-bold text-surface-100 tracking-wider">
                {fingerprint || "No identity key"}
              </span>
              {fingerprint && (
                <button onClick={handleCopy} className="p-1 rounded text-surface-500 hover:text-surface-300 transition-colors" title="Copy">
                  <Copy className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {copied && <p className="text-[10px] text-accent mt-1">Copied!</p>}
          </div>
          <p className="text-[10px] text-surface-500 text-center leading-relaxed">
            Share this fingerprint so others can confirm your identity.
            Click another user to see your shared safety number.
          </p>
        </div>
      </div>
    </div>
  );
}
