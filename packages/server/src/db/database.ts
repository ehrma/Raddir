import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    throw new Error("Database not initialized. Call initDb() first.");
  }
  return db;
}

export function initDb(dbPath: string): Database.Database {
  mkdirSync(dirname(dbPath), { recursive: true });
  db = new Database(dbPath);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  runMigrations(db);
  return db;
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);

  const applied = new Set(
    db.prepare("SELECT name FROM migrations").all().map((r: any) => r.name as string)
  );

  for (const migration of MIGRATIONS) {
    if (!applied.has(migration.name)) {
      db.transaction(() => {
        db.exec(migration.sql);
        db.prepare("INSERT INTO migrations (name) VALUES (?)").run(migration.name);
      })();
      console.log(`[db] Applied migration: ${migration.name}`);
    }
  }
}

interface Migration {
  name: string;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  {
    name: "001_initial_schema",
    sql: `
      CREATE TABLE servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        max_users INTEGER NOT NULL DEFAULT 100
      );

      CREATE TABLE channels (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        parent_id TEXT REFERENCES channels(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL DEFAULT 0,
        max_users INTEGER NOT NULL DEFAULT 0,
        join_power INTEGER NOT NULL DEFAULT 0,
        talk_power INTEGER NOT NULL DEFAULT 0,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE INDEX idx_channels_server ON channels(server_id);
      CREATE INDEX idx_channels_parent ON channels(parent_id);

      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        nickname TEXT NOT NULL,
        public_key TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE TABLE server_members (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        nickname TEXT NOT NULL,
        joined_at INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (user_id, server_id)
      );

      CREATE TABLE roles (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        permissions TEXT NOT NULL DEFAULT '{}',
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE INDEX idx_roles_server ON roles(server_id);

      CREATE TABLE member_roles (
        user_id TEXT NOT NULL,
        server_id TEXT NOT NULL,
        role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        PRIMARY KEY (user_id, server_id, role_id),
        FOREIGN KEY (user_id, server_id) REFERENCES server_members(user_id, server_id) ON DELETE CASCADE
      );

      CREATE TABLE channel_permission_overrides (
        channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        permissions TEXT NOT NULL DEFAULT '{}',
        PRIMARY KEY (channel_id, role_id)
      );

      CREATE TABLE invite_tokens (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        token TEXT NOT NULL UNIQUE,
        created_by TEXT NOT NULL REFERENCES users(id),
        max_uses INTEGER,
        uses INTEGER NOT NULL DEFAULT 0,
        expires_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE INDEX idx_invite_tokens_server ON invite_tokens(server_id);
      CREATE INDEX idx_invite_tokens_token ON invite_tokens(token);

      CREATE TABLE chat_messages (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id),
        nickname TEXT NOT NULL,
        ciphertext TEXT NOT NULL,
        iv TEXT NOT NULL,
        key_epoch INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE INDEX idx_chat_messages_channel ON chat_messages(channel_id, created_at);
    `,
  },
  {
    name: "002_bans",
    sql: `
      CREATE TABLE bans (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id),
        banned_by TEXT NOT NULL REFERENCES users(id),
        reason TEXT NOT NULL DEFAULT '',
        expires_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE INDEX idx_bans_server ON bans(server_id);
      CREATE INDEX idx_bans_user ON bans(user_id, server_id);
    `,
  },
];

export function closeDb(): void {
  if (db) {
    db.close();
  }
}
