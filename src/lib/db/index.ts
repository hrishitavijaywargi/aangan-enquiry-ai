/**
 * Persistence with two interchangeable backends behind one async interface:
 *  - Postgres (Supabase) when DATABASE_URL is set — used for the deployed app on Vercel.
 *  - SQLite via Node's built-in `node:sqlite` otherwise — local development and tests
 *    (file ./data/aangan.db; AANGAN_DB_PATH overrides, ":memory:" in tests).
 * SQL is written once with `?` placeholders in the common subset of both dialects.
 */
import fs from "node:fs";
import path from "node:path";

export type Param = string | number | null;

export interface Db {
  dialect: "sqlite" | "postgres";
  get<T>(sql: string, ...params: Param[]): Promise<T | undefined>;
  all<T>(sql: string, ...params: Param[]): Promise<T[]>;
  run(sql: string, ...params: Param[]): Promise<number>; // rows affected
  exec(sql: string): Promise<void>; // one or more statements, no params
}

const TABLES: [string, string][] = [
  [
    "enquiries",
    `id TEXT PRIMARY KEY, ref TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, caller_name TEXT,
     phone_hash TEXT, phone_masked TEXT, phone_e164 TEXT, channel TEXT NOT NULL DEFAULT 'phone', status TEXT NOT NULL,
     enquiry_type TEXT NOT NULL DEFAULT 'unknown', after_hours INTEGER NOT NULL DEFAULT 0, urgent INTEGER NOT NULL DEFAULT 0,
     is_demo INTEGER NOT NULL DEFAULT 1, scenario_key TEXT, fields TEXT NOT NULL DEFAULT '{}', agent_state TEXT NOT NULL DEFAULT '{}',
     qualification TEXT, summary TEXT, summary_source TEXT, consultation_requested INTEGER,
     consultation_status TEXT NOT NULL DEFAULT 'unknown', project_outcome TEXT NOT NULL DEFAULT 'unknown',
     first_response_seconds {REAL}, call_count INTEGER NOT NULL DEFAULT 0`,
  ],
  [
    "calls",
    `id TEXT PRIMARY KEY, enquiry_id TEXT NOT NULL REFERENCES enquiries(id) ON DELETE CASCADE, ring_at TEXT NOT NULL,
     answered_at TEXT, ended_at TEXT, response_seconds {REAL}, duration_seconds {REAL}, after_hours INTEGER NOT NULL DEFAULT 0,
     status TEXT NOT NULL, end_reason TEXT, provider TEXT NOT NULL DEFAULT 'demo', is_demo INTEGER NOT NULL DEFAULT 1, scenario_key TEXT`,
  ],
  [
    "messages",
    `id {SERIAL}, enquiry_id TEXT NOT NULL REFERENCES enquiries(id) ON DELETE CASCADE, call_id TEXT, role TEXT NOT NULL,
     text TEXT NOT NULL, at TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]'`,
  ],
  [
    "handoffs",
    `id TEXT PRIMARY KEY, enquiry_id TEXT NOT NULL REFERENCES enquiries(id) ON DELETE CASCADE, kind TEXT NOT NULL,
     created_at TEXT NOT NULL, to_address TEXT NOT NULL, subject TEXT NOT NULL, body_text TEXT NOT NULL, body_html TEXT NOT NULL,
     status TEXT NOT NULL, provider TEXT, sent_at TEXT, error TEXT, eml_path TEXT, urgent INTEGER NOT NULL DEFAULT 0`,
  ],
  [
    "ai_usage",
    `id {SERIAL}, enquiry_id TEXT, call_id TEXT, at TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
     purpose TEXT NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, is_estimate INTEGER NOT NULL, note TEXT`,
  ],
  [
    "integration_events",
    `id {SERIAL}, enquiry_id TEXT REFERENCES enquiries(id) ON DELETE CASCADE, at TEXT NOT NULL, integration TEXT NOT NULL,
     action TEXT NOT NULL, status TEXT NOT NULL, detail TEXT`,
  ],
  ["settings", "key TEXT PRIMARY KEY, value TEXT NOT NULL"],
  ["meta", "key TEXT PRIMARY KEY, value TEXT NOT NULL"],
];

const INDEXES = [
  "CREATE INDEX IF NOT EXISTS idx_enq_phone ON enquiries(phone_hash)",
  "CREATE INDEX IF NOT EXISTS idx_enq_created ON enquiries(created_at)",
  "CREATE INDEX IF NOT EXISTS idx_calls_enq ON calls(enquiry_id)",
  "CREATE INDEX IF NOT EXISTS idx_msg_enq ON messages(enquiry_id)",
  "CREATE INDEX IF NOT EXISTS idx_int_enq ON integration_events(enquiry_id)",
];

export function schemaSql(dialect: Db["dialect"]): string {
  const real = dialect === "postgres" ? "DOUBLE PRECISION" : "REAL";
  const serial = dialect === "postgres" ? "BIGSERIAL PRIMARY KEY" : "INTEGER PRIMARY KEY AUTOINCREMENT";
  return [
    ...TABLES.map(([name, cols]) => `CREATE TABLE IF NOT EXISTS ${name} (${cols.replace(/\{REAL\}/g, real).replace(/\{SERIAL\}/g, serial)})`),
    ...INDEXES,
  ].join(";\n") + ";";
}

const splitStatements = (sql: string) => sql.split(";").map((s) => s.trim()).filter(Boolean);

// ── SQLite ────────────────────────────────────────────────────────────────────
async function openSqlite(): Promise<Db> {
  const { DatabaseSync } = await import("node:sqlite");
  const p = process.env.AANGAN_DB_PATH ?? path.join(process.cwd(), "data", "aangan.db");
  if (p !== ":memory:") fs.mkdirSync(path.dirname(p), { recursive: true });
  const raw = new DatabaseSync(p);
  raw.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  raw.exec(schemaSql("sqlite"));
  // Upgrade databases created before phone_e164 existed (SQLite has no ADD COLUMN IF NOT EXISTS).
  try {
    raw.exec("ALTER TABLE enquiries ADD COLUMN phone_e164 TEXT");
  } catch {
    /* already present */
  }
  const clean = <T,>(row: unknown) => (row ? ({ ...(row as object) } as T) : undefined);
  return {
    dialect: "sqlite",
    async get<T>(sql: string, ...params: Param[]) {
      return clean<T>(raw.prepare(sql).get(...params));
    },
    async all<T>(sql: string, ...params: Param[]) {
      return raw.prepare(sql).all(...params).map((r) => clean<T>(r)!);
    },
    async run(sql: string, ...params: Param[]) {
      return Number(raw.prepare(sql).run(...params).changes);
    },
    async exec(sql: string) {
      raw.exec(sql);
    },
    close: () => raw.close(),
  } as Db & { close: () => void };
}

// ── Postgres (Supabase) ───────────────────────────────────────────────────────
async function openPostgres(url: string): Promise<Db> {
  const { default: postgres } = await import("postgres");
  const sql = postgres(url, {
    prepare: false, // required for Supabase's transaction pooler (port 6543)
    max: Number(process.env.DATABASE_POOL_MAX || 3),
    idle_timeout: 20,
    connect_timeout: 15,
    // Return COUNT/SUM (int8, numeric) as JS numbers so both backends behave the same.
    types: {
      bigint: { to: 20, from: [20], serialize: (x: number) => String(x), parse: (x: string) => Number(x) },
      numeric: { to: 1700, from: [1700], serialize: (x: number) => String(x), parse: (x: string) => Number(x) },
    },
  });
  const toPg = (q: string) => {
    let i = 0;
    return q.replace(/\?/g, () => `$${++i}`);
  };
  const db: Db & { close: () => Promise<void> } = {
    dialect: "postgres",
    async get<T>(q: string, ...params: Param[]) {
      const rows = await sql.unsafe(toPg(q), params as never[]);
      return (rows[0] as T) ?? undefined;
    },
    async all<T>(q: string, ...params: Param[]) {
      return [...(await sql.unsafe(toPg(q), params as never[]))] as T[];
    },
    async run(q: string, ...params: Param[]) {
      const r = await sql.unsafe(toPg(q), params as never[]);
      return r.count ?? 0;
    },
    async exec(q: string) {
      for (const stmt of splitStatements(q)) await sql.unsafe(stmt);
    },
    close: () => sql.end({ timeout: 5 }),
  };
  await db.exec(schemaSql("postgres"));
  await db.exec("ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS phone_e164 TEXT");
  // Supabase exposes the public schema over its REST API with the public (anon) key. RLS with no
  // policies blocks that path entirely; this server connects as the table owner, which bypasses RLS.
  for (const [t] of TABLES) await db.exec(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);
  return db;
}

// ── Connection cache (survives Next.js hot reloads and warm serverless invocations) ──
const g = globalThis as unknown as { __aanganDb?: Promise<Db>; __aanganDbKey?: string };

export function dbKey() {
  return process.env.DATABASE_URL ? "pg" : `sqlite:${process.env.AANGAN_DB_PATH ?? "file"}`;
}

export function getDb(): Promise<Db> {
  const key = dbKey();
  if (!g.__aanganDb || g.__aanganDbKey !== key) {
    g.__aanganDbKey = key;
    g.__aanganDb = process.env.DATABASE_URL ? openPostgres(process.env.DATABASE_URL) : openSqlite();
    g.__aanganDb.catch(() => (g.__aanganDb = undefined));
  }
  return g.__aanganDb;
}

/** Test helper: drop the cached connection so the next getDb() opens a fresh database. */
export async function closeDb() {
  const d = g.__aanganDb;
  g.__aanganDb = undefined;
  g.__aanganDbKey = undefined;
  if (d) await ((await d) as unknown as { close: () => unknown }).close();
}

export async function clearAllData() {
  const db = await getDb();
  await db.exec("DELETE FROM integration_events; DELETE FROM messages; DELETE FROM handoffs; DELETE FROM ai_usage; DELETE FROM calls; DELETE FROM enquiries; DELETE FROM meta;");
}

export async function getMeta(key: string): Promise<string | undefined> {
  const row = await (await getDb()).get<{ value: string }>("SELECT value FROM meta WHERE key = ?", key);
  return row?.value;
}

export async function setMeta(key: string, value: string) {
  await (await getDb()).run("INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value);
}

/** Atomically claim a one-time job (e.g. seeding) across concurrent servers. Returns true for the winner. */
export async function claimOnce(key: string): Promise<boolean> {
  const n = await (await getDb()).run("INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO NOTHING", key, new Date().toISOString());
  return n > 0;
}

/** Rows-count helper that returns a plain number on both backends. */
export async function count(sql: string, ...params: Param[]): Promise<number> {
  const r = await (await getDb()).get<{ n: number | string }>(sql, ...params);
  return Number(r?.n ?? 0);
}
