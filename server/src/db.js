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
  -- Access passwords. The admin issues these; anyone holding one can log in.
  -- Only the hash is stored. Revoking sets revoked_at (existing sessions die).
  CREATE TABLE IF NOT EXISTS credentials (
    id            TEXT PRIMARY KEY,
    label         TEXT,
    password_hash TEXT UNIQUE NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
    created_at    INTEGER NOT NULL,
    revoked_at    INTEGER,
    last_used_at  INTEGER
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id            TEXT PRIMARY KEY,
    credential_id TEXT NOT NULL,
    token_hash    TEXT UNIQUE NOT NULL,
    created_at    INTEGER NOT NULL,
    expires_at    INTEGER NOT NULL,
    FOREIGN KEY (credential_id) REFERENCES credentials(id) ON DELETE CASCADE
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
    FOREIGN KEY (uploaded_by) REFERENCES credentials(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_cred ON sessions(credential_id);
  CREATE INDEX IF NOT EXISTS idx_images_created ON images(created_at DESC);
`);
