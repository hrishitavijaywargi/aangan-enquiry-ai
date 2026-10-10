/**
 * Demo data = the September 2026 phone scenarios pushed through the SAME workflow as a live call
 * (startCall → answerCall → callerSays → endCall) with the transcript timestamps.
 * Nothing on the dashboard is hardcoded: every number is computed from what this produces.
 * Seeding never sends real email; seeded handoffs are left as previews.
 */
import fs from "node:fs";
import { mockProvider } from "../ai/provider";
import { claimOnce, clearAllData, count, getDb, getMeta, setMeta } from "../db";
import { outboxDir } from "../email/mailer";
import { answerCall, callerSays, endCall, startCall } from "../service";
import { SCENARIOS, istToDate, scenarioReply, type Scenario } from "./scenarios";

/** Deterministic pseudo-random seconds so demo data is identical on every reset. */
const jitter = (seed: string, min: number, max: number) => {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return min + (h % (max - min + 1));
};

export async function runScenarioCall(sc: Scenario, opts: { start?: Date; isDemo?: boolean } = {}) {
  const ai = mockProvider();
  let t = opts.start ?? istToDate(sc.startedAtIst);
  const { callId, enquiryId } = await startCall({ phone: sc.phone, scenarioKey: sc.key, isDemo: opts.isDemo ?? true }, { at: t });
  t = new Date(t.getTime() + jitter(sc.key + "ring", 2, 7) * 1000); // simulated ring before the AI answers
  const a = await answerCall(callId, { at: t });
  let question = a.state.lastQuestion;
  let ended = false;
  for (let turn = 0; turn < 18 && !ended; turn++) {
    if (sc.hangUpAfterTurns !== undefined && turn >= sc.hangUpAfterTurns) break;
    const line = scenarioReply(sc, question, turn);
    if (!line) break;
    t = new Date(t.getTime() + jitter(sc.key + turn, 14, 42) * 1000);
    const r = await callerSays(callId, line, { at: t, ai });
    question = r.question ?? r.state.lastQuestion;
    ended = r.ended;
  }
  t = new Date(t.getTime() + 8000);
  const dropped = sc.hangUpAfterTurns !== undefined && !ended;
  await endCall(callId, dropped ? "dropped" : "completed", { at: t, ai });
  return enquiryId;
}

export async function seedDemoData() {
  const sorted = [...SCENARIOS].sort((a, b) => a.startedAtIst.localeCompare(b.startedAtIst));
  // Seeded handoffs stay as previews — never auto-sent, even if email is configured.
  const db = await getDb();
  const prev = await db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'autoSendHandoffs'");
  await db.run("INSERT INTO settings(key, value) VALUES('autoSendHandoffs', 'false') ON CONFLICT(key) DO UPDATE SET value = 'false'");
  try {
    for (const sc of sorted) await runScenarioCall(sc);
  } finally {
    if (prev) await db.run("UPDATE settings SET value = ? WHERE key = 'autoSendHandoffs'", prev.value);
    else await db.run("DELETE FROM settings WHERE key = 'autoSendHandoffs'");
  }
  await setMeta("seeded_at", new Date().toISOString());
}

let seeding: Promise<void> | null = null;

/** Seed once on first use (empty database). Safe when several servers start at once. */
export async function ensureSeeded() {
  if ((await getMeta("seeded_at")) || (await getMeta("initialised"))) return;
  if ((await count("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM enquiries")) > 0) {
    await setMeta("initialised", "1");
    return;
  }
  if (!seeding) {
    if (!(await claimOnce("seed_lock"))) return; // another server instance is seeding
    seeding = seedDemoData().finally(() => (seeding = null));
  }
  await seeding;
}

export async function resetDemoData() {
  await clearAllData();
  try {
    for (const f of fs.readdirSync(outboxDir())) if (f.endsWith(".eml")) fs.unlinkSync(`${outboxDir()}/${f}`);
  } catch {
    /* outbox may not exist (or the filesystem is read-only on serverless hosts) */
  }
  await claimOnce("seed_lock");
  await seedDemoData();
}

/** Remove everything, leaving an empty system (e.g. before going live). */
export async function clearForLive() {
  await clearAllData();
  await setMeta("initialised", "1");
}
