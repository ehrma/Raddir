import { nanoid } from "nanoid";
import { getDb } from "../db/database.js";

export interface Ban {
  id: string;
  serverId: string;
  userId: string;
  bannedBy: string;
  reason: string;
  expiresAt: number | null;
  createdAt: number;
}

export function createBan(
  serverId: string,
  userId: string,
  bannedBy: string,
  reason = "",
  expiresAt?: number
): Ban {
  const id = nanoid();
  const db = getDb();
  db.prepare(`
    INSERT INTO bans (id, server_id, user_id, banned_by, reason, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, serverId, userId, bannedBy, reason, expiresAt ?? null);

  return {
    id,
    serverId,
    userId,
    bannedBy,
    reason,
    expiresAt: expiresAt ?? null,
    createdAt: Math.floor(Date.now() / 1000),
  };
}

export function isUserBanned(userId: string, serverId: string): boolean {
  const db = getDb();
  const row = db.prepare(`
    SELECT id, expires_at FROM bans
    WHERE user_id = ? AND server_id = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(userId, serverId) as any;

  if (!row) return false;

  if (row.expires_at && row.expires_at < Math.floor(Date.now() / 1000)) {
    db.prepare("DELETE FROM bans WHERE id = ?").run(row.id);
    return false;
  }

  return true;
}

export function removeBan(userId: string, serverId: string): void {
  const db = getDb();
  db.prepare("DELETE FROM bans WHERE user_id = ? AND server_id = ?").run(userId, serverId);
}

export function getBans(serverId: string): Ban[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM bans WHERE server_id = ? ORDER BY created_at DESC").all(serverId) as any[];
  return rows.map((row) => ({
    id: row.id,
    serverId: row.server_id,
    userId: row.user_id,
    bannedBy: row.banned_by,
    reason: row.reason,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }));
}
