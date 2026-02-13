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
  {
    name: "003_session_credentials",
    sql: `
      CREATE TABLE session_credentials (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        user_public_key TEXT NOT NULL,
        credential TEXT NOT NULL UNIQUE,
        invite_token_id TEXT REFERENCES invite_tokens(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        revoked_at INTEGER
      );

      CREATE INDEX idx_session_creds_credential ON session_credentials(credential);
      CREATE INDEX idx_session_creds_pubkey ON session_credentials(user_public_key, server_id);
    `,
  },
  {
    name: "004_invite_address_and_unique_pubkey",
    sql: `
      ALTER TABLE invite_tokens ADD COLUMN server_address TEXT NOT NULL DEFAULT '';
      CREATE UNIQUE INDEX idx_users_public_key ON users(public_key) WHERE public_key IS NOT NULL;
    `,
  },
  {
    name: "005_unbound_credentials",
    sql: `
      -- Recreate session_credentials with nullable user_public_key and bound_at column.
      -- SQLite doesn't support ALTER COLUMN, so we recreate the table.
      CREATE TABLE session_credentials_new (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        user_public_key TEXT,
        credential TEXT NOT NULL UNIQUE,
        invite_token_id TEXT REFERENCES invite_tokens(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        revoked_at INTEGER,
        bound_at INTEGER
      );
      INSERT INTO session_credentials_new (id, server_id, user_public_key, credential, invite_token_id, created_at, revoked_at, bound_at)
        SELECT id, server_id, user_public_key, credential, invite_token_id, created_at, revoked_at, created_at
        FROM session_credentials;
      DROP TABLE session_credentials;
      ALTER TABLE session_credentials_new RENAME TO session_credentials;
      CREATE INDEX idx_session_creds_credential ON session_credentials(credential);
      CREATE INDEX idx_session_creds_pubkey ON session_credentials(user_public_key, server_id);
    `,
  },
  {
    name: "006_nullable_created_by",
    sql: `
      -- Drop FK constraint on created_by (admin API has no user identity to reference).
      CREATE TABLE invite_tokens_new (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        token TEXT NOT NULL UNIQUE,
        created_by TEXT,
        max_uses INTEGER,
        uses INTEGER NOT NULL DEFAULT 0,
        expires_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        server_address TEXT NOT NULL DEFAULT ''
      );
      INSERT INTO invite_tokens_new (id, server_id, token, created_by, max_uses, uses, expires_at, created_at, server_address)
        SELECT id, server_id, token, created_by, max_uses, uses, expires_at, created_at, server_address
        FROM invite_tokens;
      DROP TABLE invite_tokens;
      ALTER TABLE invite_tokens_new RENAME TO invite_tokens;
      CREATE INDEX idx_invite_tokens_server ON invite_tokens(server_id);
      CREATE INDEX idx_invite_tokens_token ON invite_tokens(token);
    `,
  },
  {
    name: "007_credential_hash",
    sql: `
      -- Recreate session_credentials: make credential nullable and add credential_hash.
      -- New credentials store only the hash; legacy plaintext credentials are upgraded on use.
      CREATE TABLE session_credentials_new (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        user_public_key TEXT,
        credential TEXT,
        credential_hash TEXT,
        invite_token_id TEXT REFERENCES invite_tokens(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        revoked_at INTEGER,
        bound_at INTEGER
      );
      INSERT INTO session_credentials_new (id, server_id, user_public_key, credential, credential_hash, invite_token_id, created_at, revoked_at, bound_at)
        SELECT id, server_id, user_public_key, credential, NULL, invite_token_id, created_at, revoked_at, bound_at
        FROM session_credentials;
      DROP TABLE session_credentials;
      ALTER TABLE session_credentials_new RENAME TO session_credentials;
      CREATE INDEX idx_session_creds_credential ON session_credentials(credential);
      CREATE INDEX idx_session_creds_hash ON session_credentials(credential_hash);
      CREATE INDEX idx_session_creds_pubkey ON session_credentials(user_public_key, server_id);
    `,
  },
  {
    name: "008_fix_credential_nullable",
    sql: `
      -- Fix for servers that ran old 007: credential column may still be NOT NULL.
      -- Recreate with credential nullable if needed.
      CREATE TABLE session_credentials_v2 (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        user_public_key TEXT,
        credential TEXT,
        credential_hash TEXT,
        invite_token_id TEXT REFERENCES invite_tokens(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        revoked_at INTEGER,
        bound_at INTEGER
      );
      INSERT INTO session_credentials_v2 (id, server_id, user_public_key, credential, credential_hash, invite_token_id, created_at, revoked_at, bound_at)
        SELECT id, server_id, user_public_key, credential, credential_hash, invite_token_id, created_at, revoked_at, bound_at
        FROM session_credentials;
      DROP TABLE session_credentials;
      ALTER TABLE session_credentials_v2 RENAME TO session_credentials;
      CREATE INDEX idx_session_creds_credential ON session_credentials(credential);
      CREATE INDEX idx_session_creds_hash ON session_credentials(credential_hash);
      CREATE INDEX idx_session_creds_pubkey ON session_credentials(user_public_key, server_id);
    `,
  },
  {
    name: "009_unique_credential_hash",
    sql: `
      -- Replace plain index with unique partial index on active credentials.
      DROP INDEX IF EXISTS idx_session_creds_hash;
      CREATE UNIQUE INDEX idx_session_creds_hash ON session_credentials(credential_hash)
        WHERE credential_hash IS NOT NULL AND revoked_at IS NULL;
    `,
  },
  {
    name: "011_role_color",
    sql: `
      ALTER TABLE roles ADD COLUMN color TEXT DEFAULT NULL;
    `,
  },
  {
    name: "010_drop_plaintext_credential",
    sql: `
      -- Remove plaintext credential column — only credential_hash is used now.
      CREATE TABLE session_credentials_v3 (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        user_public_key TEXT,
        credential_hash TEXT,
        invite_token_id TEXT REFERENCES invite_tokens(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        revoked_at INTEGER,
        bound_at INTEGER
      );
      INSERT INTO session_credentials_v3 (id, server_id, user_public_key, credential_hash, invite_token_id, created_at, revoked_at, bound_at)
        SELECT id, server_id, user_public_key, credential_hash, invite_token_id, created_at, revoked_at, bound_at
        FROM session_credentials;
      DROP TABLE session_credentials;
      ALTER TABLE session_credentials_v3 RENAME TO session_credentials;
      CREATE INDEX idx_session_creds_pubkey ON session_credentials(user_public_key, server_id);
      CREATE UNIQUE INDEX idx_session_creds_hash ON session_credentials(credential_hash)
        WHERE credential_hash IS NOT NULL AND revoked_at IS NULL;
    `,
  },
  {
    name: "012_server_icon",
    sql: `
      ALTER TABLE servers ADD COLUMN icon_path TEXT DEFAULT NULL;
    `,
  },
];

export function closeDb(): void {
  if (db) {
    db.close();
  }
}
