import { useState, useEffect } from "react";
import { useServerStore } from "../stores/serverStore";
import { useSettingsStore } from "../stores/settingsStore";
import { getSignalingClient } from "../hooks/useConnection";
import { usePermissions } from "../hooks/usePermissions";
import { getApiBase, getAuthHeaders } from "../lib/api-base";
import { cn } from "../lib/cn";
import { Plus, Ban, Shield, X, Hash } from "lucide-react";
import { RoleEditor } from "./Admin/RoleEditor";
import { ChannelOverrides } from "./Admin/ChannelOverrides";
import { EffectivePerms } from "./Admin/EffectivePerms";

export function AdminPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"channels" | "users" | "invites" | "roles" | "overrides" | "perms">("channels");

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="w-full max-w-2xl bg-surface-900 rounded-xl border border-surface-700 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-800">
          <h2 className="text-sm font-semibold text-surface-200 flex items-center gap-2">
            <Shield className="w-4 h-4 text-accent" /> Server Admin
          </h2>
          <button onClick={onClose} className="p-1 rounded-md text-surface-400 hover:text-surface-200 hover:bg-surface-800 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex">
          <div className="w-36 border-r border-surface-800 p-2 space-y-0.5">
            {(["channels", "users", "invites", "roles", "overrides", "perms"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  "w-full px-3 py-2 rounded-lg text-xs font-medium text-left transition-colors capitalize",
                  tab === t ? "bg-accent/20 text-accent" : "text-surface-400 hover:text-surface-200 hover:bg-surface-800"
                )}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="flex-1 p-4 min-h-[350px] overflow-y-auto">
            {tab === "channels" && <ChannelAdmin />}
            {tab === "users" && <UserAdmin />}
            {tab === "invites" && <InviteAdmin />}
            {tab === "roles" && <RoleEditor />}
            {tab === "overrides" && <ChannelOverrides />}
            {tab === "perms" && <EffectivePerms />}
          </div>
        </div>
      </div>
    </div>
  );
}

function ChannelAdmin() {
  const { channels, serverId } = useServerStore();
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!newName.trim() || !serverId) return;
    setCreating(true);
    try {
      const res = await fetch(`${getApiBase()}/api/servers/${serverId}/channels`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (res.ok) {
        const ch = await res.json();
        useServerStore.setState((s) => ({ channels: [...s.channels, ch] }));
        setNewName("");
      }
    } catch (err) {
      console.error("[admin] Failed to create channel:", err);
    }
    setCreating(false);
  };

  const handleDelete = async (channelId: string) => {
    try {
      const res = await fetch(`${getApiBase()}/api/channels/${channelId}`, { method: "DELETE", headers: getAuthHeaders() });
      if (res.ok) {
        useServerStore.setState((s) => ({ channels: s.channels.filter((c) => c.id !== channelId) }));
      }
    } catch (err) {
      console.error("[admin] Failed to delete channel:", err);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          placeholder="New channel name"
          className="flex-1 px-3 py-1.5 bg-surface-800 border border-surface-700 rounded-lg text-sm text-surface-100 placeholder:text-surface-500 focus:outline-none focus:border-accent"
        />
        <button
          onClick={handleCreate}
          disabled={creating || !newName.trim()}
          className="px-3 py-1.5 bg-accent text-white text-xs rounded-lg hover:bg-accent-hover disabled:opacity-50 transition-colors flex items-center gap-1"
        >
          <Plus className="w-3 h-3" /> Create
        </button>
      </div>

      <div className="space-y-1">
        {channels.map((ch) => (
          <div key={ch.id} className="flex items-center gap-2 px-3 py-2 bg-surface-800/50 rounded-lg group">
            <Hash className="w-3.5 h-3.5 text-surface-500" />
            <span className="text-sm text-surface-300 flex-1">{ch.name}</span>
            {ch.isDefault && <span className="text-[9px] text-surface-600">(default)</span>}
            <span className="text-[10px] text-surface-600 font-mono">{ch.id.slice(0, 8)}</span>
            {!ch.isDefault && (
              <button
                onClick={() => handleDelete(ch.id)}
                className="hidden group-hover:block text-[10px] text-red-400 hover:text-red-300 transition-colors"
              >
                Delete
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function UserAdmin() {
  const { members, userId, roles } = useServerStore();
  const { can } = usePermissions();
  const allMembers = Array.from(members.values());
  const [expandedUser, setExpandedUser] = useState<string | null>(null);

  const handleKick = (targetId: string) => {
    const client = getSignalingClient();
    if (!client) return;
    client.send({ type: "kick", userId: targetId, reason: "Kicked by admin" });
  };

  const handleBan = (targetId: string) => {
    const client = getSignalingClient();
    if (!client) return;
    client.send({ type: "ban", userId: targetId, reason: "Banned by admin" });
  };

  const handleToggleRole = (targetUserId: string, roleId: string, currentlyAssigned: boolean) => {
    const client = getSignalingClient();
    if (!client) return;
    if (currentlyAssigned) {
      client.send({ type: "unassign-role", userId: targetUserId, roleId });
    } else {
      client.send({ type: "assign-role", userId: targetUserId, roleId });
    }
  };

  return (
    <div className="space-y-1">
      {allMembers.map((m) => (
        <div key={m.userId} className="bg-surface-800/50 rounded-lg">
          <div className="flex items-center gap-2 px-3 py-2 group">
            <div className="w-6 h-6 rounded-full bg-surface-700 flex items-center justify-center text-xs text-surface-300">
              {m.nickname.charAt(0).toUpperCase()}
            </div>
            <span className="text-sm text-surface-300 flex-1">
              {m.nickname}
              {m.userId === userId && <span className="text-surface-500 text-xs ml-1">(you)</span>}
            </span>
            <span className="text-[10px] text-surface-600">
              {m.channelId ? "in channel" : "idle"}
            </span>
            {m.userId !== userId && (
              <div className="hidden group-hover:flex items-center gap-1">
                {can("manageRoles") && (
                  <button
                    onClick={() => setExpandedUser(expandedUser === m.userId ? null : m.userId)}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] text-accent bg-accent/10 rounded hover:bg-accent/20 transition-colors"
                  >
                    <Shield className="w-3 h-3" /> Roles
                  </button>
                )}
                {can("kick") && (
                  <button
                    onClick={() => handleKick(m.userId)}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] text-orange-400 bg-orange-400/10 rounded hover:bg-orange-400/20 transition-colors"
                  >
                    <Ban className="w-3 h-3" /> Kick
                  </button>
                )}
                {can("ban") && (
                  <button
                    onClick={() => handleBan(m.userId)}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] text-red-400 bg-red-400/10 rounded hover:bg-red-400/20 transition-colors"
                  >
                    <Ban className="w-3 h-3" /> Ban
                  </button>
                )}
              </div>
            )}
          </div>
          {expandedUser === m.userId && (
            <div className="px-3 pb-2 flex flex-wrap gap-1">
              {roles.map((role) => {
                const assigned = (m as any).roleIds?.includes(role.id) ?? false;
                return (
                  <button
                    key={role.id}
                    onClick={() => handleToggleRole(m.userId, role.id, assigned)}
                    className={cn(
                      "px-2 py-0.5 rounded text-[10px] font-medium transition-colors",
                      assigned
                        ? "bg-accent/20 text-accent"
                        : "bg-surface-700 text-surface-500 hover:bg-surface-600"
                    )}
                  >
                    {role.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function InviteAdmin() {
  const { serverId, userId } = useServerStore();
  const [inviteBlob, setInviteBlob] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCreate = async () => {
    if (!serverId || !userId) return;
    setCreating(true);
    try {
      const { serverUrl } = useSettingsStore.getState();
      // Strip protocol and /ws path to get the raw address
      const serverAddress = serverUrl
        .replace(/^(wss?|https?):\/\//, "")
        .replace(/\/ws\/?$/, "");

      const res = await fetch(`${getApiBase()}/api/servers/${serverId}/invites`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ createdBy: userId, maxUses: 10, expiresInHours: 24, serverAddress }),
      });
      if (res.ok) {
        const data = await res.json();
        setInviteBlob(data.inviteBlob);
      }
    } catch (err) {
      console.error("[admin] Failed to create invite:", err);
    }
    setCreating(false);
  };

  const handleCopy = () => {
    if (inviteBlob) {
      navigator.clipboard.writeText(inviteBlob);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="space-y-4">
      <button
        onClick={handleCreate}
        disabled={creating}
        className="px-4 py-2 bg-accent text-white text-xs rounded-lg hover:bg-accent-hover disabled:opacity-50 transition-colors flex items-center gap-1.5"
      >
        <Plus className="w-3.5 h-3.5" />
        {creating ? "Creating..." : "Generate Invite Link"}
      </button>

      {inviteBlob && (
        <div className="p-3 bg-surface-800/50 rounded-lg border border-surface-700">
          <p className="text-xs text-surface-400 mb-2">Invite code (expires in 24h, max 10 uses):</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-[10px] font-mono text-accent bg-surface-800 px-3 py-1.5 rounded break-all select-all">
              {inviteBlob}
            </code>
            <button
              onClick={handleCopy}
              className="px-3 py-1.5 text-xs bg-surface-700 rounded text-surface-300 hover:text-surface-100 transition-colors flex-shrink-0"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
      )}

      <p className="text-[10px] text-surface-500">
        Share this invite code with users who want to join. They can paste it on the connect screen to auto-add this server.
        The server password is never included — the code grants a personal credential instead.
      </p>
    </div>
  );
}
