import { useState, useEffect } from "react";
import { useServerStore } from "../stores/serverStore";
import { useSettingsStore } from "../stores/settingsStore";
import { getSignalingClient } from "../hooks/useConnection";
import { usePermissions } from "../hooks/usePermissions";
import { getApiBase, getAuthHeaders } from "../lib/api-base";
import { cn } from "../lib/cn";
import { Plus, Ban, Shield, X, Hash, Upload, Image, Camera, Monitor } from "lucide-react";
import { RoleEditor } from "./Admin/RoleEditor";
import { ChannelOverrides } from "./Admin/ChannelOverrides";
import { EffectivePerms } from "./Admin/EffectivePerms";

export function AdminPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"general" | "channels" | "users" | "invites" | "roles" | "overrides" | "perms">("general");

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="w-full max-w-4xl max-h-[85vh] bg-surface-900 rounded-xl border border-surface-700 shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-800">
          <h2 className="text-sm font-semibold text-surface-200 flex items-center gap-2">
            <Shield className="w-4 h-4 text-accent" /> Server Admin
          </h2>
          <button onClick={onClose} className="p-1 rounded-md text-surface-400 hover:text-surface-200 hover:bg-surface-800 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-1 min-h-0">
          <div className="w-36 border-r border-surface-800 p-2 space-y-0.5 flex-shrink-0">
            {(["general", "channels", "users", "invites", "roles", "overrides", "perms"] as const).map((t) => (
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

          <div className="flex-1 p-4 min-h-[500px] overflow-y-auto">
            {tab === "general" && <ServerSettings />}
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
        setNewName("");
      } else {
        console.error("[admin] Failed to create channel:", res.status, await res.text());
      }
    } catch (err) {
      console.error("[admin] Failed to create channel:", err);
    }
    setCreating(false);
  };

  const handleDelete = async (channelId: string) => {
    try {
      const { savedServers, serverUrl } = useSettingsStore.getState();
      const server = savedServers.find((s) => s.address === serverUrl);
      const deleteHeaders: Record<string, string> = {};
      if (server?.adminToken) deleteHeaders["Authorization"] = `Bearer ${server.adminToken}`;
      const res = await fetch(`${getApiBase()}/api/channels/${channelId}`, { method: "DELETE", headers: deleteHeaders });
      if (res.ok) {
        // Update locally immediately; the channel-deleted broadcast will also fire
        // but the filter is idempotent so double-removal is safe
        useServerStore.setState((s) => ({ channels: s.channels.filter((c) => c.id !== channelId) }));
      } else {
        console.error("[admin] Failed to delete channel:", res.status, await res.text());
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
            <div className="flex items-center gap-1">
              {can("manageRoles") && (
                <button
                  onClick={() => setExpandedUser(expandedUser === m.userId ? null : m.userId)}
                  className="flex items-center gap-1 px-2 py-1 text-[10px] text-accent bg-accent/10 rounded hover:bg-accent/20 transition-colors"
                >
                  <Shield className="w-3 h-3" /> Roles
                </button>
              )}
              {m.userId !== userId && can("kick") && (
                <button
                  onClick={() => handleKick(m.userId)}
                  className="flex items-center gap-1 px-2 py-1 text-[10px] text-orange-400 bg-orange-400/10 rounded hover:bg-orange-400/20 transition-colors"
                >
                  <Ban className="w-3 h-3" /> Kick
                </button>
              )}
              {m.userId !== userId && can("ban") && (
                <button
                  onClick={() => handleBan(m.userId)}
                  className="flex items-center gap-1 px-2 py-1 text-[10px] text-red-400 bg-red-400/10 rounded hover:bg-red-400/20 transition-colors"
                >
                  <Ban className="w-3 h-3" /> Ban
                </button>
              )}
            </div>
          </div>
          {expandedUser === m.userId && (
            <div className="px-3 pb-2">
              <p className="text-[9px] text-surface-500 mb-1.5">Click to assign or remove roles:</p>
              <div className="flex flex-wrap gap-1.5">
                {roles.map((role) => {
                  const assigned = (m as any).roleIds?.includes(role.id) ?? false;
                  return (
                    <button
                      key={role.id}
                      onClick={() => handleToggleRole(m.userId, role.id, assigned)}
                      className={cn(
                        "px-2.5 py-1 rounded-md text-[10px] font-semibold transition-all flex items-center gap-1.5 border",
                        assigned
                          ? "border-green-500/50 bg-green-500/15 text-green-400"
                          : "border-surface-600 bg-surface-800 text-surface-500 hover:border-surface-500 hover:text-surface-300"
                      )}
                    >
                      {role.color && <span className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: role.color }} />}
                      {role.name}
                      <span className="text-[9px] ml-0.5">{assigned ? "✓" : "+"}</span>
                    </button>
                  );
                })}
              </div>
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
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!serverId || !userId) {
      setError("Not connected");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const { serverUrl } = useSettingsStore.getState();
      // Strip protocol and /ws path to get the raw address
      const serverAddress = serverUrl
        .replace(/^(wss?|https?):\/\//, "")
        .replace(/\/ws\/?$/, "");

      const res = await fetch(`${getApiBase()}/api/servers/${serverId}/invites`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ maxUses: 10, expiresInHours: 24, serverAddress }),
      });
      if (res.ok) {
        const data = await res.json();
        setInviteBlob(data.inviteBlob);
      } else {
        const body = await res.text();
        console.error("[admin] Invite creation failed:", res.status, body);
        setError(`Server error ${res.status}: ${body}`);
      }
    } catch (err: any) {
      console.error("[admin] Failed to create invite:", err);
      setError(`Network error: ${err.message}`);
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

      {error && (
        <p className="text-xs text-red-400 bg-red-900/20 px-3 py-2 rounded">{error}</p>
      )}

      <p className="text-[10px] text-surface-500">
        Share this invite code with users who want to join. They can paste it on the connect screen to auto-add this server.
        The server password is never included — the code grants a personal credential instead.
      </p>
    </div>
  );
}

function ServerSettings() {
  const { serverId, serverName, serverDescription, serverIconUrl, maxWebcamProducers, maxScreenProducers } = useServerStore();
  const [name, setName] = useState(serverName ?? "");
  const [description, setDescription] = useState(serverDescription ?? "");
  const [maxWebcams, setMaxWebcams] = useState(maxWebcamProducers);
  const [maxScreens, setMaxScreens] = useState(maxScreenProducers);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const [iconError, setIconError] = useState<string | null>(null);

  const iconSrc = serverIconUrl ? `${getApiBase()}${serverIconUrl}` : null;

  useEffect(() => {
    setName(serverName ?? "");
    setDescription(serverDescription ?? "");
    setMaxWebcams(maxWebcamProducers);
    setMaxScreens(maxScreenProducers);
  }, [serverName, serverDescription, maxWebcamProducers, maxScreenProducers]);

  const handleSave = async () => {
    if (!serverId || !name.trim()) return;
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch(`${getApiBase()}/api/servers/${serverId}`, {
        method: "PATCH",
        headers: getAuthHeaders(),
        body: JSON.stringify({ name: name.trim(), description, maxWebcamProducers: maxWebcams, maxScreenProducers: maxScreens }),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch (err) {
      console.error("[admin] Failed to update server:", err);
    }
    setSaving(false);
  };

  const handleIconSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      setIconError("Image too large. Maximum 2MB.");
      return;
    }

    const allowedTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"];
    if (!allowedTypes.includes(file.type)) {
      setIconError("Unsupported format. Use PNG, JPEG, WebP, or GIF.");
      return;
    }

    setIconError(null);
    const reader = new FileReader();
    reader.onload = () => {
      setIconPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleIconUpload = async () => {
    if (!serverId || !iconPreview) return;
    setUploadingIcon(true);
    setIconError(null);
    try {
      // Extract base64 data and mime type from data URL
      const match = iconPreview.match(/^data:(image\/\w+);base64,(.+)$/);
      if (!match) {
        setIconError("Invalid image data");
        setUploadingIcon(false);
        return;
      }

      const res = await fetch(`${getApiBase()}/api/servers/${serverId}/icon`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ data: match[2], mimeType: match[1] }),
      });
      if (res.ok) {
        setIconPreview(null);
        // Force icon refresh by updating store with cache-busted URL
        const data = await res.json();
        useServerStore.setState({ serverIconUrl: data.iconUrl + `?t=${Date.now()}` });
      } else {
        const body = await res.json().catch(() => ({ error: "Upload failed" }));
        setIconError(body.error ?? "Upload failed");
      }
    } catch (err) {
      console.error("[admin] Failed to upload icon:", err);
      setIconError("Network error");
    }
    setUploadingIcon(false);
  };

  const handleIconDelete = async () => {
    if (!serverId) return;
    try {
      const res = await fetch(`${getApiBase()}/api/servers/${serverId}/icon`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        useServerStore.setState({ serverIconUrl: null });
        setIconPreview(null);
      }
    } catch (err) {
      console.error("[admin] Failed to delete icon:", err);
    }
  };

  return (
    <div className="space-y-6">
      {/* Server Icon */}
      <div>
        <label className="text-xs font-medium text-surface-300 mb-2 block">Server Icon</label>
        <div className="flex items-start gap-4">
          <div className="relative group">
            {iconPreview ? (
              <img src={iconPreview} alt="Preview" className="w-20 h-20 rounded-xl object-cover border-2 border-accent/50" />
            ) : iconSrc ? (
              <img src={iconSrc} alt="Server icon" className="w-20 h-20 rounded-xl object-cover border border-surface-700" />
            ) : (
              <div className="w-20 h-20 rounded-xl bg-surface-800 border border-surface-700 flex items-center justify-center">
                <Image className="w-8 h-8 text-surface-600" />
              </div>
            )}
          </div>
          <div className="space-y-2 flex-1">
            <label className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface-800 border border-surface-700 rounded-lg text-xs text-surface-300 hover:border-surface-600 hover:text-surface-200 transition-colors cursor-pointer">
              <Upload className="w-3 h-3" /> Choose Image
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={handleIconSelect} className="hidden" />
            </label>
            {iconPreview && (
              <button
                onClick={handleIconUpload}
                disabled={uploadingIcon}
                className="ml-2 px-3 py-1.5 bg-accent text-white text-xs rounded-lg hover:bg-accent-hover disabled:opacity-50 transition-colors"
              >
                {uploadingIcon ? "Uploading..." : "Upload"}
              </button>
            )}
            {(iconSrc && !iconPreview) && (
              <button
                onClick={handleIconDelete}
                className="ml-2 px-3 py-1.5 text-xs text-red-400 bg-red-400/10 rounded-lg hover:bg-red-400/20 transition-colors"
              >
                Remove Icon
              </button>
            )}
            <p className="text-[9px] text-surface-500">Square image recommended. PNG, JPEG, WebP, or GIF. Max 2MB.</p>
            {iconError && <p className="text-[10px] text-red-400">{iconError}</p>}
          </div>
        </div>
      </div>

      {/* Server Name */}
      <div>
        <label className="text-xs font-medium text-surface-300 mb-1.5 block">Server Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Server"
          className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-sm text-surface-100 placeholder:text-surface-500 focus:outline-none focus:border-accent"
        />
      </div>

      {/* Server Description */}
      <div>
        <label className="text-xs font-medium text-surface-300 mb-1.5 block">Server Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="A short description of your server..."
          rows={3}
          className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-sm text-surface-100 placeholder:text-surface-500 focus:outline-none focus:border-accent resize-none"
        />
      </div>

      {/* Video Limits */}
      <div className="border-t border-surface-800 pt-4">
        <label className="text-xs font-medium text-surface-300 mb-3 block">Video Stream Limits (per channel)</label>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="flex items-center gap-1.5 text-[11px] text-surface-400 mb-1.5">
              <Camera className="w-3 h-3" /> Max Webcams
            </label>
            <select
              value={maxWebcams}
              onChange={(e) => setMaxWebcams(Number(e.target.value))}
              className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-sm text-surface-100 focus:outline-none focus:border-accent"
            >
              {[0, 1, 2, 3, 5, 10, 15, 20, 50].map((n) => (
                <option key={n} value={n}>{n === 0 ? "Disabled" : n}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="flex items-center gap-1.5 text-[11px] text-surface-400 mb-1.5">
              <Monitor className="w-3 h-3" /> Max Screen Shares
            </label>
            <select
              value={maxScreens}
              onChange={(e) => setMaxScreens(Number(e.target.value))}
              className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-sm text-surface-100 focus:outline-none focus:border-accent"
            >
              {[0, 1, 2, 3, 5, 10].map((n) => (
                <option key={n} value={n}>{n === 0 ? "Disabled" : n}</option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-[9px] text-surface-500 mt-1.5">Limits the number of simultaneous webcam and screen share streams per voice channel.</p>
      </div>

      {/* Save Button */}
      <button
        onClick={handleSave}
        disabled={saving || !name.trim()}
        className="px-4 py-2 bg-accent text-white text-xs rounded-lg hover:bg-accent-hover disabled:opacity-50 transition-colors"
      >
        {saving ? "Saving..." : saved ? "Saved!" : "Save Changes"}
      </button>
    </div>
  );
}
