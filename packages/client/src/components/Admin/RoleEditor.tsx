import { useState, useEffect } from "react";
import { useServerStore } from "../../stores/serverStore";
import { getApiBase, getAuthHeaders } from "../../lib/api-base";
import { cn } from "../../lib/cn";
import { Plus, Trash2, Save, ChevronDown, ChevronRight } from "lucide-react";
import type { PermissionSet, PermissionKey } from "@raddir/shared";
import { PERMISSION_KEYS } from "@raddir/shared";

interface RoleData {
  id: string;
  name: string;
  priority: number;
  permissions: PermissionSet;
  isDefault: boolean;
}

const PERMISSION_LABELS: Record<PermissionKey, string> = {
  join: "Join Channels",
  speak: "Speak",
  whisper: "Whisper",
  moveUsers: "Move Users",
  kick: "Kick",
  ban: "Ban",
  admin: "Administrator",
  manageChannels: "Manage Channels",
  managePermissions: "Manage Permissions",
  manageRoles: "Manage Roles",
};

export function RoleEditor() {
  const { serverId, roles: storeRoles } = useServerStore();
  const [roles, setRoles] = useState<RoleData[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");

  useEffect(() => {
    if (!serverId) return;
    fetchRoles();
  }, [serverId]);

  const fetchRoles = async () => {
    try {
      const res = await fetch(`${getApiBase()}/api/servers/${serverId}/roles`);
      const data = await res.json();
      setRoles(data);
      if (data.length > 0 && !selectedRoleId) {
        setSelectedRoleId(data[0].id);
      }
    } catch {
      setRoles(storeRoles.map((r) => ({
        id: r.id,
        name: r.name,
        priority: r.priority,
        permissions: r.permissions,
        isDefault: r.isDefault,
      })));
    }
  };

  const selectedRole = roles.find((r) => r.id === selectedRoleId);

  const handlePermissionChange = (key: PermissionKey, value: "allow" | "deny" | "inherit") => {
    if (!selectedRole) return;
    setRoles((prev) =>
      prev.map((r) =>
        r.id === selectedRoleId
          ? { ...r, permissions: { ...r.permissions, [key]: value } }
          : r
      )
    );
  };

  const handleSave = async () => {
    if (!selectedRole) return;
    setSaving(true);
    try {
      await fetch(`${getApiBase()}/api/roles/${selectedRole.id}`, {
        method: "PATCH",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          name: selectedRole.name,
          permissions: selectedRole.permissions,
          priority: selectedRole.priority,
        }),
      });
    } catch (err) {
      console.error("[roles] Failed to save role:", err);
    }
    setSaving(false);
  };

  const handleCreate = async () => {
    if (!newRoleName.trim() || !serverId) return;
    try {
      const defaultPerms: PermissionSet = {
        join: "allow", speak: "allow", whisper: "deny",
        moveUsers: "deny", kick: "deny", ban: "deny",
        admin: "deny", manageChannels: "deny",
        managePermissions: "deny", manageRoles: "deny",
      };
      const res = await fetch(`${getApiBase()}/api/servers/${serverId}/roles`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ name: newRoleName.trim(), permissions: defaultPerms, priority: 5 }),
      });
      const role = await res.json();
      setRoles((prev) => [...prev, role]);
      setSelectedRoleId(role.id);
      setNewRoleName("");
    } catch (err) {
      console.error("[roles] Failed to create role:", err);
    }
  };

  const handleDelete = async () => {
    if (!selectedRole || selectedRole.isDefault) return;
    try {
      await fetch(`${getApiBase()}/api/roles/${selectedRole.id}`, { method: "DELETE", headers: getAuthHeaders() });
      setRoles((prev) => prev.filter((r) => r.id !== selectedRole.id));
      setSelectedRoleId(roles[0]?.id ?? null);
    } catch (err) {
      console.error("[roles] Failed to delete role:", err);
    }
  };

  return (
    <div className="flex gap-4 h-[400px]">
      {/* Role list */}
      <div className="w-44 flex flex-col gap-2">
        <div className="space-y-0.5 flex-1 overflow-y-auto">
          {roles.map((role) => (
            <button
              key={role.id}
              onClick={() => setSelectedRoleId(role.id)}
              className={cn(
                "w-full text-left px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                role.id === selectedRoleId
                  ? "bg-accent/20 text-accent"
                  : "text-surface-400 hover:text-surface-200 hover:bg-surface-800"
              )}
            >
              {role.name}
              {role.isDefault && <span className="text-surface-600 ml-1">(default)</span>}
            </button>
          ))}
        </div>

        <div className="flex gap-1">
          <input
            type="text"
            value={newRoleName}
            onChange={(e) => setNewRoleName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            placeholder="New role..."
            className="flex-1 px-2 py-1 bg-surface-800 border border-surface-700 rounded text-xs text-surface-200 placeholder:text-surface-500 focus:outline-none focus:border-accent"
          />
          <button
            onClick={handleCreate}
            disabled={!newRoleName.trim()}
            className="p-1 rounded bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-50 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Permission editor */}
      {selectedRole ? (
        <div className="flex-1 flex flex-col gap-3 overflow-y-auto">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={selectedRole.name}
              onChange={(e) =>
                setRoles((prev) =>
                  prev.map((r) =>
                    r.id === selectedRoleId ? { ...r, name: e.target.value } : r
                  )
                )
              }
              className="px-2 py-1 bg-surface-800 border border-surface-700 rounded text-sm text-surface-200 focus:outline-none focus:border-accent"
            />
            <span className="text-[10px] text-surface-500">Priority: {selectedRole.priority}</span>
          </div>

          <div className="space-y-1">
            {PERMISSION_KEYS.map((key) => (
              <div key={key} className="flex items-center justify-between px-2 py-1.5 bg-surface-800/50 rounded">
                <span className="text-xs text-surface-300">{PERMISSION_LABELS[key]}</span>
                <div className="flex gap-1">
                  {(["allow", "deny", "inherit"] as const).map((val) => (
                    <button
                      key={val}
                      onClick={() => handlePermissionChange(key, val)}
                      className={cn(
                        "px-2 py-0.5 rounded text-[10px] font-medium transition-colors",
                        selectedRole.permissions[key] === val
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
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 mt-auto pt-2 border-t border-surface-800">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-white text-xs font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors"
            >
              <Save className="w-3 h-3" />
              {saving ? "Saving..." : "Save"}
            </button>
            {!selectedRole.isDefault && (
              <button
                onClick={handleDelete}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-red-500/10 text-red-400 text-xs font-medium hover:bg-red-500/20 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
                Delete
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-surface-500 text-xs">
          Select a role to edit
        </div>
      )}
    </div>
  );
}
