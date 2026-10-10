/**
 * Demo data = the September 2026 phone scenarios pushed through the SAME workflow as a live call
 * (startCall → answerCall → callerSays → endCall) with the transcript timestamps.
 * Nothing on the dashboard is hardcoded: every number is computed from what this produces.
 * Seeding never sends real email; seeded handoffs are left as previews.
 */
import fs from "node:fs";
import { mockProvider } from "../ai/provider";
import { clearAllData, getDb, getMeta, setMeta } from "../db";
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
  const { callId, enquiryId } = startCall({ phone: sc.phone, scenarioKey: sc.key, isDemo: opts.isDemo ?? true }, { at: t });
  t = new Date(t.getTime() + jitter(sc.key + "ring", 2, 7) * 1000); // simulated ring before the AI answers
  let a = answerCall(callId, { at: t });
  let question = a.state.lastQuestion;
  let ended = false;
  let turn = 0;
  for (; turn < 18 && !ended; turn++) {
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
  // Seeded handoffs stay as previews — never auto-sent, even if SMTP is configured.
  const db = getDb();
  const prev = db.prepare("SELECT value FROM settings WHERE key = 'autoSendHandoffs'").get() as { value: string } | undefined;
  db.prepare("INSERT INTO settings(key, value) VALUES('autoSendHandoffs', 'false') ON CONFLICT(key) DO UPDATE SET value = 'false'").run();
  try {
    for (const sc of sorted) await runScenarioCall(sc);
  } finally {
    if (prev) db.prepare("UPDATE settings SET value = ? WHERE key = 'autoSendHandoffs'").run(prev.value);
    else db.prepare("DELETE FROM settings WHERE key = 'autoSendHandoffs'").run();
  }
  setMeta("seeded_at", new Date().toISOString());
}

let seeding: Promise<void> | null = null;

/** Seed once on first use (empty database). */
export async function ensureSeeded() {
  if (getMeta("seeded_at") || getMeta("initialised")) return;
  const n = (getDb().prepare("SELECT COUNT(*) AS n FROM enquiries").get() as { n: number }).n;
  if (n > 0) {
    setMeta("initialised", "1");
    return;
  }
  seeding ??= seedDemoData().finally(() => (seeding = null));
  await seeding;
}

export async function resetDemoData() {
  clearAllData();
  try {
    for (const f of fs.readdirSync(outboxDir())) if (f.endsWith(".eml")) fs.unlinkSync(`${outboxDir()}/${f}`);
  } catch {
    /* outbox may not exist yet */
  }
  await seedDemoData();
}

/** Remove everything, leaving an empty system (e.g. before going live). */
export function clearForLive() {
  clearAllData();
  setMeta("initialised", "1");
}
