import { nanoid } from "nanoid";
import { getDb } from "../db/database.js";
import type { User, ServerMember } from "@raddir/shared";

export function createUser(nickname: string, publicKey?: string): User {
  const id = nanoid();
  const db = getDb();
  db.prepare(
    "INSERT INTO users (id, nickname, public_key) VALUES (?, ?, ?)"
  ).run(id, nickname, publicKey ?? null);

  return { id, nickname, publicKey: publicKey ?? null, createdAt: Math.floor(Date.now() / 1000) };
}

export function getUser(id: string): User | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as any;
  if (!row) return undefined;
  return {
    id: row.id,
    nickname: row.nickname,
    publicKey: row.public_key,
    createdAt: row.created_at,
  };
}

export function getUserByPublicKey(publicKey: string): User | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM users WHERE public_key = ?").get(publicKey) as any;
  if (!row) return undefined;
  return {
    id: row.id,
    nickname: row.nickname,
    publicKey: row.public_key,
    createdAt: row.created_at,
  };
}

export function addServerMember(userId: string, serverId: string, nickname: string): void {
  const db = getDb();
  db.prepare(
    "INSERT OR IGNORE INTO server_members (user_id, server_id, nickname) VALUES (?, ?, ?)"
  ).run(userId, serverId, nickname);
}

export function getServerMembers(serverId: string): ServerMember[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT sm.*, GROUP_CONCAT(mr.role_id) as role_ids
    FROM server_members sm
    LEFT JOIN member_roles mr ON mr.user_id = sm.user_id AND mr.server_id = sm.server_id
    WHERE sm.server_id = ?
    GROUP BY sm.user_id
  `).all(serverId) as any[];

  return rows.map((row) => ({
    userId: row.user_id,
    serverId: row.server_id,
    nickname: row.nickname,
    roleIds: row.role_ids ? row.role_ids.split(",") : [],
    joinedAt: row.joined_at,
  }));
}

export function assignRole(userId: string, serverId: string, roleId: string): void {
  const db = getDb();
  db.prepare(
    "INSERT OR IGNORE INTO member_roles (user_id, server_id, role_id) VALUES (?, ?, ?)"
  ).run(userId, serverId, roleId);
}

export function unassignRole(userId: string, serverId: string, roleId: string): void {
  const db = getDb();
  db.prepare(
    "DELETE FROM member_roles WHERE user_id = ? AND server_id = ? AND role_id = ?"
  ).run(userId, serverId, roleId);
}

export function updateUserAvatar(userId: string, avatarPath: string | null): void {
  const db = getDb();
  db.prepare("UPDATE users SET avatar_path = ? WHERE id = ?").run(avatarPath, userId);
}

export function getUserAvatarPath(userId: string): string | null {
  const db = getDb();
  const row = db.prepare("SELECT avatar_path FROM users WHERE id = ?").get(userId) as any;
  return row?.avatar_path ?? null;
}

export function getUserRoleIds(userId: string, serverId: string): string[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT role_id FROM member_roles WHERE user_id = ? AND server_id = ?"
  ).all(userId, serverId) as any[];
  return rows.map((r) => r.role_id);
}
