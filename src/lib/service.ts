/**
 * Enquiry workflow service — the single path every call goes through (simulator, seed data, Twilio).
 *   startCall → answerCall → callerSays (repeat) → endCall
 * Persists the transcript, structured record, qualification evidence, AI usage and handoffs.
 */
import crypto from "node:crypto";
import { finalOutcome, greet, isAfterHours, istParts, newSession, processCallerTurn, type Session } from "./agent";
import { getAIProvider, mockProvider, templateSummary, type AIProvider, type AIUsage } from "./ai/provider";
import { getDb } from "./db";
import { emailConfig, sendEmail } from "./email/mailer";
import { buildHandoff } from "./handoff";
import { getSettings } from "./settings";
import type { EnquiryFields, EnquiryStatus, QualificationResult, TranscriptMessage } from "./types";

export interface EnquiryRow {
  id: string;
  ref: string;
  created_at: string;
  updated_at: string;
  caller_name: string | null;
  phone_hash: string | null;
  phone_masked: string | null;
  status: EnquiryStatus;
  enquiry_type: string;
  after_hours: number;
  urgent: number;
  is_demo: number;
  scenario_key: string | null;
  fields: string;
  agent_state: string;
  qualification: string | null;
  summary: string | null;
  summary_source: string | null;
  consultation_requested: number | null;
  consultation_status: string;
  project_outcome: string;
  first_response_seconds: number | null;
  call_count: number;
}

export interface CallRow {
  id: string;
  enquiry_id: string;
  ring_at: string;
  answered_at: string | null;
  ended_at: string | null;
  response_seconds: number | null;
  duration_seconds: number | null;
  after_hours: number;
  status: string;
  end_reason: string | null;
  provider: string;
  is_demo: number;
  scenario_key: string | null;
}

export interface HandoffRow {
  id: string;
  enquiry_id: string;
  kind: string;
  created_at: string;
  to_address: string;
  subject: string;
  body_text: string;
  body_html: string;
  status: string;
  provider: string | null;
  sent_at: string | null;
  error: string | null;
  eml_path: string | null;
  urgent: number;
}

interface Opts {
  at?: Date; // override clock (seeding / tests)
  ai?: AIProvider; // override AI provider (seeding always uses mock)
}

const now = (o?: Opts) => o?.at ?? new Date();
const json = <T,>(s: string | null | undefined, fallback: T): T => {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

export function normalisePhone(p: string): string {
  const d = p.replace(/\D/g, "");
  return d.length > 10 ? d.slice(-10) : d;
}
export const hashPhone = (p: string) => crypto.createHash("sha256").update("aangan:" + normalisePhone(p)).digest("hex").slice(0, 32);
export const maskPhone = (p: string) => {
  const d = normalisePhone(p);
  return d.length >= 4 ? `+91 ••••• •${d.slice(-4)}` : "Withheld";
};

function ctxFor(at: Date) {
  const s = getSettings();
  return { now: at, settings: { festivalDates: s.festivalDates, officeStartHour: s.officeStartHour, officeEndHour: s.officeEndHour, workingDays: s.workingDays } };
}

export function getEnquiry(id: string): EnquiryRow | undefined {
  return getDb().prepare("SELECT * FROM enquiries WHERE id = ?").get(id) as unknown as EnquiryRow | undefined;
}
export function getCall(id: string): CallRow | undefined {
  return getDb().prepare("SELECT * FROM calls WHERE id = ?").get(id) as unknown as CallRow | undefined;
}

function loadSession(e: EnquiryRow): Session {
  const fields = json<EnquiryFields>(e.fields, {});
  const state = json<Session["state"] | null>(e.agent_state, null);
  return state && state.phase ? { fields, state } : { ...newSession(), fields: { ...newSession().fields, ...fields } };
}

function saveSession(enquiryId: string, s: Session, q: QualificationResult, at: Date) {
  getDb()
    .prepare("UPDATE enquiries SET fields = ?, agent_state = ?, qualification = ?, caller_name = COALESCE(?, caller_name), consultation_requested = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(s.fields), JSON.stringify(s.state), JSON.stringify(q), s.fields.callerName ?? null, s.fields.consultationRequested === undefined ? null : s.fields.consultationRequested ? 1 : 0, at.toISOString(), enquiryId);
}

function addMessage(enquiryId: string, callId: string | null, m: TranscriptMessage) {
  getDb().prepare("INSERT INTO messages(enquiry_id, call_id, role, text, at, tags) VALUES(?, ?, ?, ?, ?, ?)").run(enquiryId, callId, m.role, m.text, m.at, JSON.stringify(m.tags ?? []));
}

function recordUsage(enquiryId: string, callId: string | null, at: Date, ai: AIProvider, purpose: string, u: AIUsage) {
  getDb()
    .prepare("INSERT INTO ai_usage(enquiry_id, call_id, at, provider, model, purpose, input_tokens, output_tokens, is_estimate, note) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(enquiryId, callId, at.toISOString(), ai.name, ai.model, purpose, u.inputTokens, u.outputTokens, u.isEstimate ? 1 : 0, u.note ?? null);
}

function nextRef(): string {
  const row = getDb().prepare("SELECT COUNT(*) AS n FROM enquiries").get() as { n: number };
  return `ENQ-${String(1001 + row.n)}`;
}

export interface StartCallInput {
  phone?: string;
  callerLabel?: string;
  scenarioKey?: string;
  provider?: "demo" | "twilio";
  isDemo?: boolean;
}

/**
 * Incoming call starts ringing. Repeat calls from the same number within the de-duplication
 * window attach to the existing enquiry instead of creating a new one.
 */
export function startCall(input: StartCallInput, o?: Opts) {
  const db = getDb();
  const at = now(o);
  const settings = getSettings();
  const phone = input.phone?.trim() || `+9190000${String(Math.floor(Math.random() * 1e5)).padStart(5, "0")}`;
  const hash = hashPhone(phone);
  const since = new Date(at.getTime() - settings.dedupeWindowDays * 86_400_000).toISOString();
  const existing = db
    .prepare("SELECT * FROM enquiries WHERE phone_hash = ? AND created_at >= ? AND created_at <= ? ORDER BY created_at DESC LIMIT 1")
    .get(hash, since, at.toISOString()) as unknown as EnquiryRow | undefined;
  const afterHours = isAfterHours(at, settings);
  const isDemo = input.isDemo ?? true;

  let enquiryId: string;
  let repeat = false;
  if (existing) {
    enquiryId = existing.id;
    repeat = true;
    db.prepare("UPDATE enquiries SET call_count = call_count + 1, updated_at = ?, status = 'in_progress' WHERE id = ?").run(at.toISOString(), enquiryId);
  } else {
    enquiryId = crypto.randomUUID();
    const s = newSession();
    db.prepare(
      `INSERT INTO enquiries(id, ref, created_at, updated_at, caller_name, phone_hash, phone_masked, status, enquiry_type, after_hours, is_demo, scenario_key, fields, agent_state, call_count)
       VALUES(?, ?, ?, ?, NULL, ?, ?, 'in_progress', 'unknown', ?, ?, ?, ?, ?, 1)`,
    ).run(enquiryId, nextRef(), at.toISOString(), at.toISOString(), hash, maskPhone(phone), afterHours ? 1 : 0, isDemo ? 1 : 0, input.scenarioKey ?? null, JSON.stringify(s.fields), JSON.stringify(s.state));
  }
  const callId = crypto.randomUUID();
  db.prepare("INSERT INTO calls(id, enquiry_id, ring_at, status, after_hours, provider, is_demo, scenario_key) VALUES(?, ?, ?, 'ringing', ?, ?, ?, ?)").run(
    callId, enquiryId, at.toISOString(), afterHours ? 1 : 0, input.provider ?? "demo", isDemo ? 1 : 0, input.scenarioKey ?? null,
  );
  return { callId, enquiryId, repeatCaller: repeat, afterHours, phoneMasked: maskPhone(phone) };
}

/** The agent picks up. Response time = answered_at − ring_at (measured, not assumed). */
export function answerCall(callId: string, o?: Opts) {
  const db = getDb();
  const at = now(o);
  const call = getCall(callId);
  if (!call) throw new Error("Call not found");
  if (call.status !== "ringing") throw new Error("Call already answered");
  const e = getEnquiry(call.enquiry_id)!;
  const responseSeconds = Math.max(0, (at.getTime() - new Date(call.ring_at).getTime()) / 1000);
  db.prepare("UPDATE calls SET answered_at = ?, response_seconds = ?, status = 'in_progress' WHERE id = ?").run(at.toISOString(), responseSeconds, callId);
  if (e.first_response_seconds === null) db.prepare("UPDATE enquiries SET first_response_seconds = ? WHERE id = ?").run(responseSeconds, e.id);

  const session = loadSession(e);
  if (e.call_count > 1) {
    // Fresh call on an existing enquiry: re-open the conversation, keep everything already known.
    // Questions left unanswered on an earlier (e.g. dropped) call may be asked again; answered ones never are.
    session.state.phase = "collecting";
    session.state.closeReason = undefined;
    session.state.asked = {};
    addMessage(e.id, callId, { role: "system", text: `Repeat call #${e.call_count} from the same number — merged into ${e.ref} (not counted as a new enquiry).`, at: at.toISOString(), tags: ["dedupe"] });
  }
  const r = greet(session, ctxFor(at), { repeatCaller: e.call_count > 1 });
  addMessage(e.id, callId, { role: "agent", text: r.reply, at: at.toISOString(), tags: r.events });
  saveSession(e.id, r.session, r.qualification, at);
  return { reply: r.reply, responseSeconds, qualification: r.qualification, fields: r.session.fields, state: r.session.state };
}

export async function callerSays(callId: string, text: string, o?: Opts) {
  const at = now(o);
  const call = getCall(callId);
  if (!call) throw new Error("Call not found");
  if (call.status !== "in_progress") throw new Error("Call is not in progress");
  const clean = text.trim().slice(0, 2000);
  if (!clean) throw new Error("Empty message");
  const e = getEnquiry(call.enquiry_id)!;
  const session = loadSession(e);
  addMessage(e.id, callId, { role: "caller", text: clean, at: at.toISOString() });

  // AI interpretation (gap-filling only). Failures fall back to deterministic extraction.
  const ai = o?.ai ?? getAIProvider();
  let aiFields: Partial<EnquiryFields> | undefined;
  try {
    const res = await ai.extractFields(clean, session.fields);
    aiFields = res.fields;
    recordUsage(e.id, callId, at, ai, "extract", res.usage);
  } catch (err) {
    addMessage(e.id, callId, { role: "system", text: `AI extraction unavailable (${(err as Error).message}); deterministic extraction used.`, at: at.toISOString(), tags: ["ai_error"] });
  }

  const r = processCallerTurn(session, clean, ctxFor(at), aiFields);
  const replyAt = new Date(at.getTime() + 1500);
  addMessage(e.id, callId, { role: "agent", text: r.reply, at: replyAt.toISOString(), tags: r.events });
  saveSession(e.id, r.session, r.qualification, at);
  if (r.events.includes("escalated")) getDb().prepare("UPDATE enquiries SET urgent = 1, enquiry_type = 'complaint' WHERE id = ?").run(e.id);
  return { reply: r.reply, ended: r.ended, events: r.events, question: r.question, qualification: r.qualification, fields: r.session.fields, state: r.session.state };
}

/** Call ends (agent finished or caller hung up). Decide outcome, summarise, create handoff. */
export async function endCall(callId: string, reason: "completed" | "caller_hung_up" | "dropped" = "completed", o?: Opts) {
  const db = getDb();
  const at = now(o);
  const call = getCall(callId);
  if (!call) throw new Error("Call not found");
  if (call.status === "completed" || call.status === "dropped") return getEnquiry(call.enquiry_id)!;
  const e = getEnquiry(call.enquiry_id)!;
  const session = loadSession(e);
  const out = finalOutcome(session, at);
  const duration = Math.max(0, (at.getTime() - new Date(call.ring_at).getTime()) / 1000);
  db.prepare("UPDATE calls SET ended_at = ?, duration_seconds = ?, status = ?, end_reason = ? WHERE id = ?").run(at.toISOString(), duration, reason === "dropped" ? "dropped" : "completed", reason, callId);
  if (reason !== "completed") addMessage(e.id, callId, { role: "system", text: reason === "dropped" ? "Line dropped." : "Caller hung up.", at: at.toISOString(), tags: [reason] });

  // Summary (LLM if configured, else template). The outcome text is decided by the rules engine.
  const transcript = (db.prepare("SELECT role, text FROM messages WHERE enquiry_id = ? ORDER BY id").all(e.id) as { role: string; text: string }[])
    .filter((m) => m.role !== "system")
    .map((m) => `${m.role === "agent" ? "Agent" : "Caller"}: ${m.text}`)
    .join("\n");
  const ai = o?.ai ?? getAIProvider();
  let summary: string;
  let summarySource: string;
  try {
    const s = await ai.summarise(transcript, session.fields, out.qualification.summary);
    summary = s.text;
    summarySource = s.source;
    recordUsage(e.id, callId, at, ai, "summary", s.usage);
  } catch {
    summary = templateSummary(session.fields, out.qualification.summary);
    summarySource = "template";
  }

  db.prepare("UPDATE enquiries SET status = ?, enquiry_type = ?, urgent = ?, qualification = ?, summary = ?, summary_source = ?, updated_at = ? WHERE id = ?").run(
    out.status, out.type, out.urgent ? 1 : 0, JSON.stringify(out.qualification), summary, summarySource, at.toISOString(), e.id,
  );

  if (out.status === "qualified" || out.status === "escalated") await createHandoff(e.id, { at });
  return getEnquiry(e.id)!;
}

/** Build (or rebuild) the handoff for an enquiry and deliver it per settings. */
export async function createHandoff(enquiryId: string, o?: Opts & { forceSend?: boolean }) {
  const db = getDb();
  const at = now(o);
  const e = getEnquiry(enquiryId);
  if (!e) throw new Error("Enquiry not found");
  if (e.status !== "qualified" && e.status !== "escalated") throw new Error("Only qualified or escalated enquiries get a handoff");
  const fields = json<EnquiryFields>(e.fields, {});
  const q = json<QualificationResult>(e.qualification, { decision: "not_applicable", criteria: [], failed: [], unclear: [], uncertainties: [], summary: "" });
  const created = new Date(e.created_at);
  const ist = istParts(created);
  const note = buildHandoff({
    ref: e.ref,
    phoneMasked: e.phone_masked ?? "Withheld",
    createdAtIst: `${ist.date} ${String(ist.hour).padStart(2, "0")}:${String(ist.minute).padStart(2, "0")}`,
    afterHours: !!e.after_hours,
    fields,
    qualification: q,
    summary: e.summary ?? "",
    callCount: e.call_count,
    isDemo: !!e.is_demo,
  });
  const cfg = emailConfig();
  const to = note.kind === "escalation" ? cfg.escalationTo : cfg.handoffTo;
  const prior = db.prepare("SELECT * FROM handoffs WHERE enquiry_id = ? AND kind = ? ORDER BY created_at DESC LIMIT 1").get(e.id, note.kind) as unknown as HandoffRow | undefined;
  if (prior && (prior.status === "sent" || prior.status === "saved_locally") && !o?.forceSend && prior.body_text === note.text) return prior;

  const id = crypto.randomUUID();
  db.prepare("INSERT INTO handoffs(id, enquiry_id, kind, created_at, to_address, subject, body_text, body_html, status, urgent) VALUES(?, ?, ?, ?, ?, ?, ?, ?, 'preview', ?)").run(
    id, e.id, note.kind, at.toISOString(), to, note.subject, note.text, note.html, note.urgent ? 1 : 0,
  );
  if (getSettings().autoSendHandoffs || o?.forceSend) await deliverHandoff(id);
  return db.prepare("SELECT * FROM handoffs WHERE id = ?").get(id) as unknown as HandoffRow;
}

export async function deliverHandoff(handoffId: string) {
  const db = getDb();
  const h = db.prepare("SELECT * FROM handoffs WHERE id = ?").get(handoffId) as unknown as HandoffRow | undefined;
  if (!h) throw new Error("Handoff not found");
  const res = await sendEmail({ id: h.id, to: h.to_address, subject: h.subject, text: h.body_text, html: h.body_html, urgent: !!h.urgent });
  db.prepare("UPDATE handoffs SET status = ?, provider = ?, sent_at = ?, error = ?, eml_path = ? WHERE id = ?").run(res.status, res.provider, res.sentAt ?? null, res.error ?? null, res.emlPath ?? null, h.id);
  return db.prepare("SELECT * FROM handoffs WHERE id = ?").get(h.id) as unknown as HandoffRow;
}

export function updateOutcome(enquiryId: string, patch: { consultation_status?: string; project_outcome?: string }) {
  const allowedC = ["unknown", "scheduled", "completed", "no_show", "cancelled"];
  const allowedP = ["unknown", "won", "lost"];
  if (patch.consultation_status && !allowedC.includes(patch.consultation_status)) throw new Error("Invalid consultation status");
  if (patch.project_outcome && !allowedP.includes(patch.project_outcome)) throw new Error("Invalid project outcome");
  const e = getEnquiry(enquiryId);
  if (!e) throw new Error("Enquiry not found");
  getDb()
    .prepare("UPDATE enquiries SET consultation_status = COALESCE(?, consultation_status), project_outcome = COALESCE(?, project_outcome), updated_at = ? WHERE id = ?")
    .run(patch.consultation_status ?? null, patch.project_outcome ?? null, new Date().toISOString(), enquiryId);
  return getEnquiry(enquiryId)!;
}

export function enquiryDetail(id: string) {
  const db = getDb();
  const e = getEnquiry(id);
  if (!e) return undefined;
  return {
    enquiry: e,
    fields: json<EnquiryFields>(e.fields, {}),
    state: json<Session["state"] | null>(e.agent_state, null),
    qualification: json<QualificationResult | null>(e.qualification, null),
    messages: db.prepare("SELECT * FROM messages WHERE enquiry_id = ? ORDER BY id").all(id) as unknown as (TranscriptMessage & { id: number; call_id: string; tags: string })[],
    calls: db.prepare("SELECT * FROM calls WHERE enquiry_id = ? ORDER BY ring_at").all(id) as unknown as CallRow[],
    handoffs: db.prepare("SELECT * FROM handoffs WHERE enquiry_id = ? ORDER BY created_at DESC").all(id) as unknown as HandoffRow[],
    usage: db.prepare("SELECT * FROM ai_usage WHERE enquiry_id = ? ORDER BY id").all(id) as unknown as { provider: string; model: string; purpose: string; input_tokens: number; output_tokens: number; is_estimate: number }[],
  };
}

export { mockProvider };
