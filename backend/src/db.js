// Shared database layer (SQLite). Both the web app and the Android app use this DB via the REST API.
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'elibrary.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name     TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS guest_sessions (
  id         TEXT PRIMARY KEY,               -- random UUID issued by /auth/guest
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS books (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  author       TEXT NOT NULL,
  category     TEXT NOT NULL,
  description  TEXT,
  cover_url    TEXT,
  download_url TEXT NOT NULL,                -- ONLY legally authorized sources (public domain / open license)
  license      TEXT NOT NULL DEFAULT 'Public Domain',
  source       TEXT NOT NULL DEFAULT 'Project Gutenberg',
  year         INTEGER,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (title, author)                     -- guarantees unique books (200 required by Phase 3)
);
CREATE INDEX IF NOT EXISTS idx_books_title    ON books(title);
CREATE INDEX IF NOT EXISTS idx_books_author   ON books(author);
CREATE INDEX IF NOT EXISTS idx_books_category ON books(category);

CREATE TABLE IF NOT EXISTS favorites (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id    INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, book_id)
);

-- "My Library" (saved by the user or, later, by the AI agent after confirmation)
CREATE TABLE IF NOT EXISTS library (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id    INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  added_via  TEXT NOT NULL DEFAULT 'manual',  -- 'manual' | 'ai_agent'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, book_id)
);

-- Download records. Exactly one of user_id / guest_id is set. Limits are enforced by the backend.
CREATE TABLE IF NOT EXISTS downloads (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  guest_id   TEXT    REFERENCES guest_sessions(id) ON DELETE CASCADE,
  book_id    INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((user_id IS NOT NULL) + (guest_id IS NOT NULL) = 1)
);
CREATE INDEX IF NOT EXISTS idx_dl_user  ON downloads(user_id);
CREATE INDEX IF NOT EXISTS idx_dl_guest ON downloads(guest_id);

-- Planned for Phase 2/3: audit trail of every AI agent tool call.
CREATE TABLE IF NOT EXISTS ai_tool_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  tool_name  TEXT NOT NULL,
  arguments  TEXT,
  result     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

module.exports = db;
