import { useState, useEffect } from "react";
import { useServerStore } from "../../stores/serverStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { cn } from "../../lib/cn";
import { Save, Hash } from "lucide-react";
import type { PermissionSet, PermissionKey, ChannelPermissionOverride } from "@raddir/shared";
import { PERMISSION_KEYS } from "@raddir/shared";

const PERMISSION_LABELS: Record<PermissionKey, string> = {
  join: "Join", speak: "Speak", whisper: "Whisper",
  moveUsers: "Move Users", kick: "Kick", ban: "Ban",
  admin: "Admin", manageChannels: "Manage Channels",
  managePermissions: "Manage Perms", manageRoles: "Manage Roles",
};

function getApiBase(): string {
  const wsUrl = useSettingsStore.getState().serverUrl;
  return wsUrl.replace(/^ws/, "http").replace(/\/ws$/, "");
}

export function ChannelOverrides() {
  const { channels, roles } = useServerStore();
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<ChannelPermissionOverride[]>([]);
  const [localPerms, setLocalPerms] = useState<Partial<PermissionSet>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (channels.length > 0 && !selectedChannelId) {
      setSelectedChannelId(channels[0].id);
    }
  }, [channels, selectedChannelId]);

  useEffect(() => {
    if (roles.length > 0 && !selectedRoleId) {
      setSelectedRoleId(roles[0].id);
    }
  }, [roles, selectedRoleId]);

  useEffect(() => {
    if (!selectedChannelId) return;
    fetchOverrides(selectedChannelId);
  }, [selectedChannelId]);

  useEffect(() => {
    if (!selectedChannelId || !selectedRoleId) return;
    const existing = overrides.find(
      (o) => o.channelId === selectedChannelId && o.roleId === selectedRoleId
    );
    setLocalPerms(existing?.permissions ?? {});
  }, [selectedChannelId, selectedRoleId, overrides]);

  const fetchOverrides = async (channelId: string) => {
    try {
      const res = await fetch(`${getApiBase()}/api/channels/${channelId}/overrides`);
      const data = await res.json();
      setOverrides(data);
    } catch {
      setOverrides([]);
    }
  };

  const handlePermChange = (key: PermissionKey, value: "allow" | "deny" | "inherit") => {
    setLocalPerms((prev) => {
      const next = { ...prev };
      if (value === "inherit") {
        delete next[key];
      } else {
        next[key] = value;
      }
      return next;
    });
  };

  const handleSave = async () => {
    if (!selectedChannelId || !selectedRoleId) return;
    setSaving(true);
    try {
      await fetch(
        `${getApiBase()}/api/channels/${selectedChannelId}/overrides/${selectedRoleId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ permissions: localPerms }),
        }
      );
      await fetchOverrides(selectedChannelId);
    } catch (err) {
      console.error("[overrides] Failed to save:", err);
    }
    setSaving(false);
  };

  const selectedRole = roles.find((r) => r.id === selectedRoleId);

  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        {/* Channel selector */}
        <div className="flex-1">
          <label className="text-[10px] text-surface-500 uppercase tracking-wider mb-1 block">Channel</label>
          <select
            value={selectedChannelId ?? ""}
            onChange={(e) => setSelectedChannelId(e.target.value)}
            className="w-full px-2 py-1.5 bg-surface-800 border border-surface-700 rounded text-xs text-surface-200 focus:outline-none focus:border-accent"
          >
            {channels.map((ch) => (
              <option key={ch.id} value={ch.id}>{ch.name}</option>
            ))}
          </select>
        </div>

        {/* Role selector */}
        <div className="flex-1">
          <label className="text-[10px] text-surface-500 uppercase tracking-wider mb-1 block">Role</label>
          <select
            value={selectedRoleId ?? ""}
            onChange={(e) => setSelectedRoleId(e.target.value)}
            className="w-full px-2 py-1.5 bg-surface-800 border border-surface-700 rounded text-xs text-surface-200 focus:outline-none focus:border-accent"
          >
            {roles.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>
      </div>

      {selectedRole && (
        <>
          <p className="text-[10px] text-surface-500">
            Overrides for <span className="text-surface-300 font-medium">{selectedRole.name}</span> in this channel.
            Set to "inherit" to use the role's default.
          </p>

          <div className="space-y-1">
            {PERMISSION_KEYS.map((key) => {
              const current = localPerms[key];
              const roleDefault = selectedRole.permissions[key];
              return (
                <div key={key} className="flex items-center justify-between px-2 py-1.5 bg-surface-800/50 rounded">
                  <div>
                    <span className="text-xs text-surface-300">{PERMISSION_LABELS[key]}</span>
                    <span className="text-[9px] text-surface-600 ml-2">role: {roleDefault}</span>
                  </div>
                  <div className="flex gap-1">
                    {(["allow", "deny", "inherit"] as const).map((val) => {
                      const isActive = val === "inherit" ? current === undefined : current === val;
                      return (
                        <button
                          key={val}
                          onClick={() => handlePermChange(key, val)}
                          className={cn(
                            "px-2 py-0.5 rounded text-[10px] font-medium transition-colors",
                            isActive
                              ? val === "allow"
                                ? "bg-green-500/20 text-green-400"
                                : val === "deny"
                                ? "bg-red-500/20 text-red-400"
                                : "bg-surface-600/30 text-surface-300"
                              : "text-surface-500 hover:bg-surface-700"
                          )}
                        >
                          {val}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-white text-xs font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors"
          >
            <Save className="w-3 h-3" />
            {saving ? "Saving..." : "Save Overrides"}
          </button>
        </>
      )}
    </div>
  );
}
