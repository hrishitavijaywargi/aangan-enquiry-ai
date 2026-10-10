/**
 * Enquiry workflow service — the single path every call goes through (simulator, seed data, Vaani, Twilio).
 *   startCall → answerCall → callerSays (repeat) → endCall
 * Persists the transcript, structured record, qualification evidence, AI usage, handoffs and integrations.
 */
import crypto from "node:crypto";
import { finalOutcome, greet, isAfterHours, istParts, newSession, processCallerTurn, type Session } from "./agent";
import { getAIProvider, mockProvider, templateSummary, type AIProvider, type AIUsage } from "./ai/provider";
import { count, getDb } from "./db";
import { emailConfig, sendEmail } from "./email/mailer";
import { buildHandoff } from "./handoff";
import { calendlyUrl, integrationEvents, runAfterCall } from "./integrations";
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
  phone_e164: string | null; // stored for live (non-demo) calls only, so the designer can call back
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
const toE164 = (p: string) => {
  const d = normalisePhone(p);
  return d.length === 10 ? `+91${d}` : p.trim();
};

async function ctxFor(at: Date) {
  const s = await getSettings();
  return { now: at, settings: { festivalDates: s.festivalDates, officeStartHour: s.officeStartHour, officeEndHour: s.officeEndHour, workingDays: s.workingDays } };
}

export async function getEnquiry(id: string): Promise<EnquiryRow | undefined> {
  return (await getDb()).get<EnquiryRow>("SELECT * FROM enquiries WHERE id = ?", id);
}
export async function getCall(id: string): Promise<CallRow | undefined> {
  return (await getDb()).get<CallRow>("SELECT * FROM calls WHERE id = ?", id);
}

function loadSession(e: EnquiryRow): Session {
  const fields = json<EnquiryFields>(e.fields, {});
  const state = json<Session["state"] | null>(e.agent_state, null);
  return state && state.phase ? { fields, state } : { ...newSession(), fields: { ...newSession().fields, ...fields } };
}

async function saveSession(enquiryId: string, s: Session, q: QualificationResult, at: Date) {
  await (await getDb()).run(
    "UPDATE enquiries SET fields = ?, agent_state = ?, qualification = ?, caller_name = COALESCE(?, caller_name), consultation_requested = ?, updated_at = ? WHERE id = ?",
    JSON.stringify(s.fields), JSON.stringify(s.state), JSON.stringify(q), s.fields.callerName ?? null,
    s.fields.consultationRequested === undefined ? null : s.fields.consultationRequested ? 1 : 0, at.toISOString(), enquiryId,
  );
}

async function addMessage(enquiryId: string, callId: string | null, m: TranscriptMessage) {
  await (await getDb()).run("INSERT INTO messages(enquiry_id, call_id, role, text, at, tags) VALUES(?, ?, ?, ?, ?, ?)", enquiryId, callId, m.role, m.text, m.at, JSON.stringify(m.tags ?? []));
}

async function recordUsage(enquiryId: string, callId: string | null, at: Date, ai: AIProvider, purpose: string, u: AIUsage) {
  await (await getDb()).run(
    "INSERT INTO ai_usage(enquiry_id, call_id, at, provider, model, purpose, input_tokens, output_tokens, is_estimate, note) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    enquiryId, callId, at.toISOString(), ai.name, ai.model, purpose, u.inputTokens, u.outputTokens, u.isEstimate ? 1 : 0, u.note ?? null,
  );
}

async function nextRef(): Promise<string> {
  return `ENQ-${1001 + (await count("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM enquiries"))}`;
}

export interface StartCallInput {
  phone?: string;
  callerLabel?: string;
  scenarioKey?: string;
  provider?: "demo" | "twilio" | "vaani";
  isDemo?: boolean;
}

/**
 * Incoming call starts ringing. Repeat calls from the same number within the de-duplication
 * window attach to the existing enquiry instead of creating a new one.
 */
export async function startCall(input: StartCallInput, o?: Opts) {
  const db = await getDb();
  const at = now(o);
  const settings = await getSettings();
  const phone = input.phone?.trim() || `+9190000${String(Math.floor(Math.random() * 1e5)).padStart(5, "0")}`;
  const hash = hashPhone(phone);
  const since = new Date(at.getTime() - settings.dedupeWindowDays * 86_400_000).toISOString();
  const existing = await db.get<EnquiryRow>(
    "SELECT * FROM enquiries WHERE phone_hash = ? AND created_at >= ? AND created_at <= ? ORDER BY created_at DESC LIMIT 1",
    hash, since, at.toISOString(),
  );
  const afterHours = isAfterHours(at, settings);
  const isDemo = input.isDemo ?? true;

  let enquiryId: string;
  let repeat = false;
  if (existing) {
    enquiryId = existing.id;
    repeat = true;
    await db.run("UPDATE enquiries SET call_count = call_count + 1, updated_at = ?, status = 'in_progress' WHERE id = ?", at.toISOString(), enquiryId);
  } else {
    enquiryId = crypto.randomUUID();
    const s = newSession();
    await db.run(
      `INSERT INTO enquiries(id, ref, created_at, updated_at, caller_name, phone_hash, phone_masked, phone_e164, status, enquiry_type, after_hours, is_demo, scenario_key, fields, agent_state, call_count)
       VALUES(?, ?, ?, ?, NULL, ?, ?, ?, 'in_progress', 'unknown', ?, ?, ?, ?, ?, 1)`,
      enquiryId, await nextRef(), at.toISOString(), at.toISOString(), hash, maskPhone(phone), isDemo || !input.phone ? null : toE164(phone),
      afterHours ? 1 : 0, isDemo ? 1 : 0, input.scenarioKey ?? null, JSON.stringify(s.fields), JSON.stringify(s.state),
    );
  }
  const callId = crypto.randomUUID();
  await db.run(
    "INSERT INTO calls(id, enquiry_id, ring_at, status, after_hours, provider, is_demo, scenario_key) VALUES(?, ?, ?, 'ringing', ?, ?, ?, ?)",
    callId, enquiryId, at.toISOString(), afterHours ? 1 : 0, input.provider ?? "demo", isDemo ? 1 : 0, input.scenarioKey ?? null,
  );
  return { callId, enquiryId, repeatCaller: repeat, afterHours, phoneMasked: maskPhone(phone) };
}

/**
 * The agent picks up. Response time = answered_at − ring_at (measured, not assumed).
 * `greetingOverride`: the welcome line a voice platform (e.g. Vaani) actually spoke, so the transcript stays faithful.
 */
export async function answerCall(callId: string, o?: Opts & { greetingOverride?: string }) {
  const db = await getDb();
  const at = now(o);
  const call = await getCall(callId);
  if (!call) throw new Error("Call not found");
  if (call.status !== "ringing") throw new Error("Call already answered");
  const e = (await getEnquiry(call.enquiry_id))!;
  const responseSeconds = Math.max(0, (at.getTime() - new Date(call.ring_at).getTime()) / 1000);
  await db.run("UPDATE calls SET answered_at = ?, response_seconds = ?, status = 'in_progress' WHERE id = ?", at.toISOString(), responseSeconds, callId);
  if (e.first_response_seconds === null) await db.run("UPDATE enquiries SET first_response_seconds = ? WHERE id = ?", responseSeconds, e.id);

  const session = loadSession(e);
  if (e.call_count > 1) {
    // Fresh call on an existing enquiry: re-open the conversation, keep everything already known.
    // Questions left unanswered on an earlier (e.g. dropped) call may be asked again; answered ones never are.
    session.state.phase = "collecting";
    session.state.closeReason = undefined;
    session.state.asked = {};
    await addMessage(e.id, callId, { role: "system", text: `Repeat call #${e.call_count} from the same number — merged into ${e.ref} (not counted as a new enquiry).`, at: at.toISOString(), tags: ["dedupe"] });
  }
  const r = greet(session, await ctxFor(at), { repeatCaller: e.call_count > 1 });
  const spoken = o?.greetingOverride?.trim() || r.reply;
  await addMessage(e.id, callId, { role: "agent", text: spoken, at: at.toISOString(), tags: r.events });
  await saveSession(e.id, r.session, r.qualification, at);
  return { reply: spoken, responseSeconds, qualification: r.qualification, fields: r.session.fields, state: r.session.state };
}

export async function callerSays(callId: string, text: string, o?: Opts) {
  const at = now(o);
  const call = await getCall(callId);
  if (!call) throw new Error("Call not found");
  if (call.status !== "in_progress") throw new Error("Call is not in progress");
  const clean = text.trim().slice(0, 2000);
  if (!clean) throw new Error("Empty message");
  const e = (await getEnquiry(call.enquiry_id))!;
  const session = loadSession(e);
  await addMessage(e.id, callId, { role: "caller", text: clean, at: at.toISOString() });

  // AI interpretation (gap-filling only). Failures fall back to deterministic extraction.
  const ai = o?.ai ?? getAIProvider();
  let aiFields: Partial<EnquiryFields> | undefined;
  try {
    const res = await ai.extractFields(clean, session.fields);
    aiFields = res.fields;
    await recordUsage(e.id, callId, at, ai, "extract", res.usage);
  } catch (err) {
    await addMessage(e.id, callId, { role: "system", text: `AI extraction unavailable (${(err as Error).message}); deterministic extraction used.`, at: at.toISOString(), tags: ["ai_error"] });
  }

  const r = processCallerTurn(session, clean, await ctxFor(at), aiFields);
  const replyAt = new Date(at.getTime() + 1500);
  await addMessage(e.id, callId, { role: "agent", text: r.reply, at: replyAt.toISOString(), tags: r.events });
  await saveSession(e.id, r.session, r.qualification, at);
  if (r.events.includes("escalated")) await (await getDb()).run("UPDATE enquiries SET urgent = 1, enquiry_type = 'complaint' WHERE id = ?", e.id);
  return { reply: r.reply, ended: r.ended, events: r.events, question: r.question, qualification: r.qualification, fields: r.session.fields, state: r.session.state };
}

/** Call ends (agent finished or caller hung up). Decide outcome, summarise, hand off, run integrations. */
export async function endCall(callId: string, reason: "completed" | "caller_hung_up" | "dropped" = "completed", o?: Opts) {
  const db = await getDb();
  const at = now(o);
  const call = await getCall(callId);
  if (!call) throw new Error("Call not found");
  if (call.status === "completed" || call.status === "dropped") return (await getEnquiry(call.enquiry_id))!;
  const e = (await getEnquiry(call.enquiry_id))!;
  const session = loadSession(e);
  const out = finalOutcome(session, at);
  const duration = Math.max(0, (at.getTime() - new Date(call.ring_at).getTime()) / 1000);
  await db.run("UPDATE calls SET ended_at = ?, duration_seconds = ?, status = ?, end_reason = ? WHERE id = ?", at.toISOString(), duration, reason === "dropped" ? "dropped" : "completed", reason, callId);
  if (reason !== "completed") await addMessage(e.id, callId, { role: "system", text: reason === "dropped" ? "Line dropped." : "Caller hung up.", at: at.toISOString(), tags: [reason] });

  // Summary (LLM if configured, else template). The outcome text is decided by the rules engine.
  const transcript = (await db.all<{ role: string; text: string }>("SELECT role, text FROM messages WHERE enquiry_id = ? ORDER BY id", e.id))
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
    await recordUsage(e.id, callId, at, ai, "summary", s.usage);
  } catch {
    summary = templateSummary(session.fields, out.qualification.summary);
    summarySource = "template";
  }

  await db.run(
    "UPDATE enquiries SET status = ?, enquiry_type = ?, urgent = ?, qualification = ?, summary = ?, summary_source = ?, updated_at = ? WHERE id = ?",
    out.status, out.type, out.urgent ? 1 : 0, JSON.stringify(out.qualification), summary, summarySource, at.toISOString(), e.id,
  );

  if (out.status === "qualified" || out.status === "escalated") await createHandoff(e.id, { at });
  await runAfterCall({
    enquiryId: e.id, ref: e.ref, status: out.status, urgent: out.urgent, isDemo: !!e.is_demo, phone: e.phone_e164 ?? undefined,
    fields: session.fields, qualification: out.qualification, summary,
  });
  return (await getEnquiry(e.id))!;
}

/** Build (or rebuild) the handoff for an enquiry and deliver it per settings. */
export async function createHandoff(enquiryId: string, o?: Opts & { forceSend?: boolean }) {
  const db = await getDb();
  const at = now(o);
  const e = await getEnquiry(enquiryId);
  if (!e) throw new Error("Enquiry not found");
  if (e.status !== "qualified" && e.status !== "escalated") throw new Error("Only qualified or escalated enquiries get a handoff");
  const fields = json<EnquiryFields>(e.fields, {});
  const q = json<QualificationResult>(e.qualification, { decision: "not_applicable", criteria: [], failed: [], unclear: [], uncertainties: [], summary: "" });
  const ist = istParts(new Date(e.created_at));
  const note = buildHandoff({
    ref: e.ref,
    phoneMasked: e.phone_e164 ?? e.phone_masked ?? "Withheld",
    createdAtIst: `${ist.date} ${String(ist.hour).padStart(2, "0")}:${String(ist.minute).padStart(2, "0")}`,
    afterHours: !!e.after_hours,
    fields,
    qualification: q,
    summary: e.summary ?? "",
    callCount: e.call_count,
    isDemo: !!e.is_demo,
    calendlyUrl: calendlyUrl(),
  });
  const cfg = emailConfig();
  const to = note.kind === "escalation" ? cfg.escalationTo : cfg.handoffTo;
  const prior = await db.get<HandoffRow>("SELECT * FROM handoffs WHERE enquiry_id = ? AND kind = ? ORDER BY created_at DESC LIMIT 1", e.id, note.kind);
  if (prior && (prior.status === "sent" || prior.status === "saved_locally") && !o?.forceSend && prior.body_text === note.text) return prior;

  const id = crypto.randomUUID();
  await db.run(
    "INSERT INTO handoffs(id, enquiry_id, kind, created_at, to_address, subject, body_text, body_html, status, urgent) VALUES(?, ?, ?, ?, ?, ?, ?, ?, 'preview', ?)",
    id, e.id, note.kind, at.toISOString(), to, note.subject, note.text, note.html, note.urgent ? 1 : 0,
  );
  if ((await getSettings()).autoSendHandoffs || o?.forceSend) await deliverHandoff(id);
  return (await db.get<HandoffRow>("SELECT * FROM handoffs WHERE id = ?", id))!;
}

export async function deliverHandoff(handoffId: string) {
  const db = await getDb();
  const h = await db.get<HandoffRow>("SELECT * FROM handoffs WHERE id = ?", handoffId);
  if (!h) throw new Error("Handoff not found");
  const res = await sendEmail({ id: h.id, to: h.to_address, subject: h.subject, text: h.body_text, html: h.body_html, urgent: !!h.urgent });
  await db.run("UPDATE handoffs SET status = ?, provider = ?, sent_at = ?, error = ?, eml_path = ? WHERE id = ?", res.status, res.provider, res.sentAt ?? null, res.error ?? null, res.emlPath ?? null, h.id);
  return (await db.get<HandoffRow>("SELECT * FROM handoffs WHERE id = ?", h.id))!;
}

export async function updateOutcome(enquiryId: string, patch: { consultation_status?: string; project_outcome?: string }) {
  const allowedC = ["unknown", "scheduled", "completed", "no_show", "cancelled"];
  const allowedP = ["unknown", "won", "lost"];
  if (patch.consultation_status && !allowedC.includes(patch.consultation_status)) throw new Error("Invalid consultation status");
  if (patch.project_outcome && !allowedP.includes(patch.project_outcome)) throw new Error("Invalid project outcome");
  const e = await getEnquiry(enquiryId);
  if (!e) throw new Error("Enquiry not found");
  await (await getDb()).run(
    "UPDATE enquiries SET consultation_status = COALESCE(?, consultation_status), project_outcome = COALESCE(?, project_outcome), updated_at = ? WHERE id = ?",
    patch.consultation_status ?? null, patch.project_outcome ?? null, new Date().toISOString(), enquiryId,
  );
  return (await getEnquiry(enquiryId))!;
}

export async function enquiryDetail(id: string) {
  const db = await getDb();
  const e = await getEnquiry(id);
  if (!e) return undefined;
  return {
    enquiry: e,
    fields: json<EnquiryFields>(e.fields, {}),
    state: json<Session["state"] | null>(e.agent_state, null),
    qualification: json<QualificationResult | null>(e.qualification, null),
    messages: await db.all<TranscriptMessage & { id: number; call_id: string; tags: string }>("SELECT * FROM messages WHERE enquiry_id = ? ORDER BY id", id),
    calls: await db.all<CallRow>("SELECT * FROM calls WHERE enquiry_id = ? ORDER BY ring_at", id),
    handoffs: await db.all<HandoffRow>("SELECT * FROM handoffs WHERE enquiry_id = ? ORDER BY created_at DESC", id),
    usage: await db.all<{ provider: string; model: string; purpose: string; input_tokens: number; output_tokens: number; is_estimate: number }>("SELECT * FROM ai_usage WHERE enquiry_id = ? ORDER BY id", id),
    integrations: await integrationEvents(id),
  };
}

export { mockProvider };
