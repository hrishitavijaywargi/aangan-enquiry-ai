/**
 * SQLite persistence using Node's built-in `node:sqlite` (Node ≥ 22.13) — no native build step.
 * The database file lives in ./data/aangan.db (override with AANGAN_DB_PATH, ":memory:" in tests).
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS enquiries (
  id TEXT PRIMARY KEY,
  ref TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  caller_name TEXT,
  phone_hash TEXT,
  phone_masked TEXT,
  channel TEXT NOT NULL DEFAULT 'phone',
  status TEXT NOT NULL,
  enquiry_type TEXT NOT NULL DEFAULT 'unknown',
  after_hours INTEGER NOT NULL DEFAULT 0,
  urgent INTEGER NOT NULL DEFAULT 0,
  is_demo INTEGER NOT NULL DEFAULT 1,
  scenario_key TEXT,
  fields TEXT NOT NULL DEFAULT '{}',
  agent_state TEXT NOT NULL DEFAULT '{}',
  qualification TEXT,
  summary TEXT,
  summary_source TEXT,
  consultation_requested INTEGER,
  consultation_status TEXT NOT NULL DEFAULT 'unknown',
  project_outcome TEXT NOT NULL DEFAULT 'unknown',
  first_response_seconds REAL,
  call_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_enq_phone ON enquiries(phone_hash);
CREATE INDEX IF NOT EXISTS idx_enq_created ON enquiries(created_at);

CREATE TABLE IF NOT EXISTS calls (
  id TEXT PRIMARY KEY,
  enquiry_id TEXT NOT NULL REFERENCES enquiries(id) ON DELETE CASCADE,
  ring_at TEXT NOT NULL,
  answered_at TEXT,
  ended_at TEXT,
  response_seconds REAL,
  duration_seconds REAL,
  after_hours INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  end_reason TEXT,
  provider TEXT NOT NULL DEFAULT 'demo',
  is_demo INTEGER NOT NULL DEFAULT 1,
  scenario_key TEXT
);
CREATE INDEX IF NOT EXISTS idx_calls_enq ON calls(enquiry_id);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  enquiry_id TEXT NOT NULL REFERENCES enquiries(id) ON DELETE CASCADE,
  call_id TEXT,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  at TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_msg_enq ON messages(enquiry_id);

CREATE TABLE IF NOT EXISTS handoffs (
  id TEXT PRIMARY KEY,
  enquiry_id TEXT NOT NULL REFERENCES enquiries(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL,
  to_address TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  body_html TEXT NOT NULL,
  status TEXT NOT NULL,
  provider TEXT,
  sent_at TEXT,
  error TEXT,
  eml_path TEXT,
  urgent INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ai_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  enquiry_id TEXT,
  call_id TEXT,
  at TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  purpose TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  is_estimate INTEGER NOT NULL,
  note TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const g = globalThis as unknown as { __aanganDb?: DatabaseSync; __aanganDbPath?: string };

export function dbPath(): string {
  return process.env.AANGAN_DB_PATH ?? path.join(process.cwd(), "data", "aangan.db");
}

export function getDb(): DatabaseSync {
  const p = dbPath();
  if (g.__aanganDb && g.__aanganDbPath === p) return g.__aanganDb;
  if (p !== ":memory:") fs.mkdirSync(path.dirname(p), { recursive: true });
  const db = new DatabaseSync(p);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  g.__aanganDb = db;
  g.__aanganDbPath = p;
  return db;
}

/** Test helper: drop the cached connection so the next getDb() opens a fresh database. */
export function closeDb() {
  g.__aanganDb?.close();
  g.__aanganDb = undefined;
  g.__aanganDbPath = undefined;
}

export function clearAllData() {
  const db = getDb();
  db.exec("DELETE FROM messages; DELETE FROM handoffs; DELETE FROM ai_usage; DELETE FROM calls; DELETE FROM enquiries; DELETE FROM meta;");
}

export function getMeta(key: string): string | undefined {
  const row = getDb().prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value;
}

export function setMeta(key: string, value: string) {
  getDb().prepare("INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}
