/** `npx tsx scripts/check-db.ts` — verifies DATABASE_URL from .env.local connects (prints no secrets). */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
(async () => {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) return console.log("DATABASE_URL missing from .env.local");
  const u = new URL(url);
  console.log(`host: ${u.hostname}  port: ${u.port}  user: ${u.username}  password set: ${u.password && !u.password.includes("YOUR-PASSWORD") ? "yes" : "NO"}`);
  const { getDb, count } = await import("../src/lib/db");
  const db = await getDb();
  console.log("connected via", db.dialect);
  console.log("enquiries in Supabase:", await count("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM enquiries"));
  process.exit(0);
})().catch((e) => { console.log("CONNECTION FAILED:", e.message.replace(/postgres(ql)?:\/\/[^@\s]+@/g, "postgresql://***@")); process.exit(1); });
