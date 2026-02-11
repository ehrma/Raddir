import { nanoid } from "nanoid";
import { getDb } from "../db/database.js";
import type { Channel } from "@raddir/shared";

export function createChannel(
  serverId: string,
  name: string,
  opts: Partial<Pick<Channel, "parentId" | "description" | "position" | "maxUsers" | "joinPower" | "talkPower" | "isDefault">> = {}
): Channel {
  const id = nanoid();
  const db = getDb();
  db.prepare(`
    INSERT INTO channels (id, server_id, parent_id, name, description, position, max_users, join_power, talk_power, is_default)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    serverId,
    opts.parentId ?? null,
    name,
    opts.description ?? "",
    opts.position ?? 0,
    opts.maxUsers ?? 0,
    opts.joinPower ?? 0,
    opts.talkPower ?? 0,
    opts.isDefault ? 1 : 0
  );

  return {
    id,
    serverId,
    parentId: opts.parentId ?? null,
    name,
    description: opts.description ?? "",
    position: opts.position ?? 0,
    maxUsers: opts.maxUsers ?? 0,
    joinPower: opts.joinPower ?? 0,
    talkPower: opts.talkPower ?? 0,
    isDefault: opts.isDefault ?? false,
    createdAt: Math.floor(Date.now() / 1000),
  };
}

export function getChannelsByServer(serverId: string): Channel[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM channels WHERE server_id = ? ORDER BY position ASC").all(serverId) as any[];
  return rows.map(rowToChannel);
}

export function getChannel(id: string): Channel | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM channels WHERE id = ?").get(id) as any;
  if (!row) return undefined;
  return rowToChannel(row);
}

export function getDefaultChannel(serverId: string): Channel | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM channels WHERE server_id = ? AND is_default = 1 LIMIT 1").get(serverId) as any;
  if (!row) return undefined;
  return rowToChannel(row);
}

export function deleteChannel(id: string): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM channels WHERE id = ? AND is_default = 0").run(id);
  return result.changes > 0;
}

export function ensureDefaultChannels(serverId: string): Channel[] {
  const existing = getChannelsByServer(serverId);
  if (existing.length > 0) return existing;

  const lobby = createChannel(serverId, "Lobby", { position: 0, isDefault: true });
  const general = createChannel(serverId, "General", { position: 1 });
  const afk = createChannel(serverId, "AFK", { position: 2 });

  return [lobby, general, afk];
}

function rowToChannel(row: any): Channel {
  return {
    id: row.id,
    serverId: row.server_id,
    parentId: row.parent_id,
    name: row.name,
    description: row.description,
    position: row.position,
    maxUsers: row.max_users,
    joinPower: row.join_power,
    talkPower: row.talk_power,
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
  };
}
