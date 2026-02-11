import { nanoid } from "nanoid";
import { getDb } from "../db/database.js";
import type { Server } from "@raddir/shared";

export function createServer(name: string, description = ""): Server {
  const id = nanoid();
  const db = getDb();
  db.prepare(
    "INSERT INTO servers (id, name, description) VALUES (?, ?, ?)"
  ).run(id, name, description);

  return { id, name, description, createdAt: Math.floor(Date.now() / 1000), maxUsers: 100 };
}

export function getServer(id: string): Server | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM servers WHERE id = ?").get(id) as any;
  if (!row) return undefined;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    maxUsers: row.max_users,
  };
}

export function getDefaultServer(): Server | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM servers ORDER BY created_at ASC LIMIT 1").get() as any;
  if (!row) return undefined;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    maxUsers: row.max_users,
  };
}

export function ensureDefaultServer(): Server {
  const existing = getDefaultServer();
  if (existing) return existing;
  return createServer("Default Server", "Welcome to Raddir!");
}
