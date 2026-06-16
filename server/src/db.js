// SQLite via better-sqlite3 (synchronous, perfect for a single-VM app).
// Opens the DB, applies migrations on boot, and exports the handle.
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "./config.js";

// Ensure the DB directory exists before opening.
fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  -- Access credentials. Now username/password accounts instead of random tokens.
  CREATE TABLE IF NOT EXISTS credentials (
    id            TEXT PRIMARY KEY,
    label         TEXT,
    username      TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
    created_at    INTEGER NOT NULL,
    revoked_at    INTEGER,
    last_used_at  INTEGER,
    created_by    TEXT,
    FOREIGN KEY (created_by) REFERENCES credentials(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id            TEXT PRIMARY KEY,
    credential_id TEXT NOT NULL,
    token_hash    TEXT UNIQUE NOT NULL,
    created_at    INTEGER NOT NULL,
    expires_at    INTEGER NOT NULL,
    FOREIGN KEY (credential_id) REFERENCES credentials(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS folders (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    parent_id  TEXT,
    owner_id   TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE,
    FOREIGN KEY (owner_id)  REFERENCES credentials(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS images (
    id            TEXT PRIMARY KEY,
    uploaded_by   TEXT,
    visibility    TEXT NOT NULL CHECK (visibility IN ('public','private')),
    stored_path   TEXT NOT NULL,
    original_name TEXT,
    mime          TEXT NOT NULL,
    size          INTEGER NOT NULL,
    created_at    INTEGER NOT NULL,
    folder_id     TEXT,
    FOREIGN KEY (uploaded_by) REFERENCES credentials(id) ON DELETE SET NULL,
    FOREIGN KEY (folder_id)   REFERENCES folders(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_cred ON sessions(credential_id);
  CREATE INDEX IF NOT EXISTS idx_images_created ON images(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_images_folder ON images(folder_id);
`);

// Additive idempotent migrations — guard with try/catch for ALTER TABLE
// since these are no-ops if the column already exists (SQLite doesn't support
// IF NOT EXISTS for columns).

function addColumnIfMissing(table, column, definition) {
  const cols = db.pragma(`table_info(${table})`).map((c) => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// credentials: username and created_by may be absent in old DBs
addColumnIfMissing("credentials", "username", "TEXT UNIQUE");
addColumnIfMissing("credentials", "created_by", "TEXT REFERENCES credentials(id) ON DELETE SET NULL");

// images: folder_id may be absent in old DBs
addColumnIfMissing("images", "folder_id", "TEXT REFERENCES folders(id) ON DELETE SET NULL");
