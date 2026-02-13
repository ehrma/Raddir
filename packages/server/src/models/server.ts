import { nanoid } from "nanoid";
import { getDb } from "../db/database.js";
import type { Server } from "@raddir/shared";

export function createServer(name: string, description = ""): Server {
  const id = nanoid();
  const db = getDb();
  db.prepare(
    "INSERT INTO servers (id, name, description) VALUES (?, ?, ?)"
  ).run(id, name, description);

  return { id, name, description, iconPath: null, createdAt: Math.floor(Date.now() / 1000), maxUsers: 100 };
}

export function getServer(id: string): Server | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM servers WHERE id = ?").get(id) as any;
  if (!row) return undefined;
  return rowToServer(row);
}

export function getDefaultServer(): Server | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM servers ORDER BY created_at ASC LIMIT 1").get() as any;
  if (!row) return undefined;
  return rowToServer(row);
}

export function updateServer(id: string, updates: { name?: string; description?: string; iconPath?: string | null }): void {
  const db = getDb();
  const sets: string[] = [];
  const values: any[] = [];
  if (updates.name !== undefined) { sets.push("name = ?"); values.push(updates.name); }
  if (updates.description !== undefined) { sets.push("description = ?"); values.push(updates.description); }
  if (updates.iconPath !== undefined) { sets.push("icon_path = ?"); values.push(updates.iconPath); }
  if (sets.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE servers SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

function rowToServer(row: any): Server {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    maxUsers: row.max_users,
    iconPath: row.icon_path ?? null,
  };
}

export function ensureDefaultServer(): Server {
  const existing = getDefaultServer();
  if (existing) return existing;
  return createServer("Default Server", "Welcome to Raddir!");
}
