import { useState, useEffect } from "react";
import { useServerStore } from "../../stores/serverStore";
import { getApiBase } from "../../lib/api-base";
import type { PermissionKey, PermissionSet } from "@raddir/shared";
import { PERMISSION_KEYS } from "@raddir/shared";
import { cn } from "../../lib/cn";

const PERMISSION_LABELS: Record<PermissionKey, string> = {
  join: "Join Channels", speak: "Speak", whisper: "Whisper",
  moveUsers: "Move Users", kick: "Kick", ban: "Ban",
  admin: "Administrator", manageChannels: "Manage Channels",
  managePermissions: "Manage Permissions", manageRoles: "Manage Roles",
};

export function EffectivePerms() {
  const { serverId, members, channels } = useServerStore();
  const allMembers = Array.from(members.values());
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<string>("");
  const [perms, setPerms] = useState<PermissionSet | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (allMembers.length > 0 && !selectedUserId) {
      setSelectedUserId(allMembers[0].userId);
    }
  }, [allMembers.length, selectedUserId]);

  useEffect(() => {
    if (!serverId || !selectedUserId) return;
    fetchPerms();
  }, [serverId, selectedUserId, selectedChannelId]);

  const fetchPerms = async () => {
    if (!serverId || !selectedUserId) return;
    setLoading(true);
    try {
      const qs = selectedChannelId ? `?channelId=${selectedChannelId}` : "";
      const res = await fetch(
        `${getApiBase()}/api/servers/${serverId}/users/${selectedUserId}/permissions${qs}`
      );
      const data = await res.json();
      setPerms(data);
    } catch {
      setPerms(null);
    }
    setLoading(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="text-[10px] text-surface-500 uppercase tracking-wider mb-1 block">User</label>
          <select
            value={selectedUserId ?? ""}
            onChange={(e) => setSelectedUserId(e.target.value)}
            className="w-full px-2 py-1.5 bg-surface-800 border border-surface-700 rounded text-xs text-surface-200 focus:outline-none focus:border-accent"
          >
            {allMembers.map((m) => (
              <option key={m.userId} value={m.userId}>{m.nickname}</option>
            ))}
          </select>
        </div>

        <div className="flex-1">
          <label className="text-[10px] text-surface-500 uppercase tracking-wider mb-1 block">Channel (optional)</label>
          <select
            value={selectedChannelId}
            onChange={(e) => setSelectedChannelId(e.target.value)}
            className="w-full px-2 py-1.5 bg-surface-800 border border-surface-700 rounded text-xs text-surface-200 focus:outline-none focus:border-accent"
          >
            <option value="">Server-level</option>
            {channels.map((ch) => (
              <option key={ch.id} value={ch.id}>{ch.name}</option>
            ))}
          </select>
        </div>
      </div>

      {loading && <p className="text-xs text-surface-500">Loading...</p>}

      {perms && !loading && (
        <div className="space-y-1">
          {PERMISSION_KEYS.map((key) => {
            const val = perms[key];
            return (
              <div key={key} className="flex items-center justify-between px-2 py-1.5 bg-surface-800/50 rounded">
                <span className="text-xs text-surface-300">{PERMISSION_LABELS[key]}</span>
                <span
                  className={cn(
                    "text-[10px] font-medium px-2 py-0.5 rounded",
                    val === "allow" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
                  )}
                >
                  {val}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
