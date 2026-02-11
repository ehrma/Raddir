import { nanoid } from "nanoid";
import { getDb } from "../db/database.js";
import type { Role, ChannelPermissionOverride, PermissionSet } from "@raddir/shared";
import { DEFAULT_ADMIN_PERMISSIONS, DEFAULT_MEMBER_PERMISSIONS, DEFAULT_GUEST_PERMISSIONS } from "@raddir/shared";

export function createRole(
  serverId: string,
  name: string,
  permissions: PermissionSet,
  opts: { priority?: number; isDefault?: boolean } = {}
): Role {
  const id = nanoid();
  const db = getDb();
  db.prepare(`
    INSERT INTO roles (id, server_id, name, priority, permissions, is_default)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, serverId, name, opts.priority ?? 0, JSON.stringify(permissions), opts.isDefault ? 1 : 0);

  return {
    id,
    serverId,
    name,
    priority: opts.priority ?? 0,
    permissions,
    isDefault: opts.isDefault ?? false,
    createdAt: Math.floor(Date.now() / 1000),
  };
}

export function getRolesByServer(serverId: string): Role[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM roles WHERE server_id = ? ORDER BY priority DESC").all(serverId) as any[];
  return rows.map(rowToRole);
}

export function getRole(id: string): Role | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM roles WHERE id = ?").get(id) as any;
  if (!row) return undefined;
  return rowToRole(row);
}

export function getDefaultRole(serverId: string): Role | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM roles WHERE server_id = ? AND is_default = 1 LIMIT 1").get(serverId) as any;
  if (!row) return undefined;
  return rowToRole(row);
}

export function getUserRoles(userId: string, serverId: string): Role[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT r.* FROM roles r
    JOIN member_roles mr ON mr.role_id = r.id
    WHERE mr.user_id = ? AND mr.server_id = ?
    ORDER BY r.priority DESC
  `).all(userId, serverId) as any[];
  return rows.map(rowToRole);
}

export function getChannelOverrides(channelId: string): ChannelPermissionOverride[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM channel_permission_overrides WHERE channel_id = ?").all(channelId) as any[];
  return rows.map((row) => ({
    channelId: row.channel_id,
    roleId: row.role_id,
    permissions: JSON.parse(row.permissions),
  }));
}

export function setChannelOverride(channelId: string, roleId: string, permissions: Partial<PermissionSet>): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO channel_permission_overrides (channel_id, role_id, permissions)
    VALUES (?, ?, ?)
    ON CONFLICT (channel_id, role_id) DO UPDATE SET permissions = excluded.permissions
  `).run(channelId, roleId, JSON.stringify(permissions));
}

export function updateRole(id: string, updates: { name?: string; permissions?: PermissionSet; priority?: number }): void {
  const db = getDb();
  const sets: string[] = [];
  const values: any[] = [];

  if (updates.name !== undefined) { sets.push("name = ?"); values.push(updates.name); }
  if (updates.permissions !== undefined) { sets.push("permissions = ?"); values.push(JSON.stringify(updates.permissions)); }
  if (updates.priority !== undefined) { sets.push("priority = ?"); values.push(updates.priority); }

  if (sets.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE roles SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export function deleteRole(id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM roles WHERE id = ? AND is_default = 0").run(id);
}

export function deleteChannelOverride(channelId: string, roleId: string): void {
  const db = getDb();
  db.prepare("DELETE FROM channel_permission_overrides WHERE channel_id = ? AND role_id = ?").run(channelId, roleId);
}

export function ensureDefaultRoles(serverId: string): Role[] {
  const existing = getRolesByServer(serverId);
  if (existing.length > 0) return existing;

  const admin = createRole(serverId, "Admin", DEFAULT_ADMIN_PERMISSIONS, { priority: 100 });
  const member = createRole(serverId, "Member", DEFAULT_MEMBER_PERMISSIONS, { priority: 10, isDefault: true });
  const guest = createRole(serverId, "Guest", DEFAULT_GUEST_PERMISSIONS, { priority: 1 });

  return [admin, member, guest];
}

function rowToRole(row: any): Role {
  return {
    id: row.id,
    serverId: row.server_id,
    name: row.name,
    priority: row.priority,
    permissions: JSON.parse(row.permissions),
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
  };
}
