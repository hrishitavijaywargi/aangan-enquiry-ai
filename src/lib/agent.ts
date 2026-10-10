/**
 * Front-desk conversation engine (pure, deterministic).
 * - Interprets each caller utterance (extract.ts, optionally assisted by an LLM for gaps)
 * - Re-runs the qualification engine every turn (qualification.ts) — the AI cannot override it
 * - Picks ONE next question, never repeating one already answered or asked
 * - Every caller-facing reply passes the pricing guard (pricingGuard.ts)
 */
import { DECLINE_LINE, PRICING_SCRIPT } from "./config/business";
import { extract } from "./extract";
import { guardCallerReply } from "./pricingGuard";
import { CRITERIA_NAMES, qualify } from "./qualification";
import type { AgentState, EnquiryFields, EnquiryStatus, EnquiryType, QualificationResult, QuestionKey, Settings } from "./types";

export interface Session {
  fields: EnquiryFields;
  state: AgentState;
}

export interface TurnContext {
  now: Date;
  settings: Pick<Settings, "festivalDates" | "officeStartHour" | "officeEndHour" | "workingDays">;
}

export interface TurnResult {
  session: Session;
  reply: string;
  qualification: QualificationResult;
  ended: boolean;
  question?: QuestionKey;
  events: string[];
}

export function newSession(): Session {
  return {
    fields: { declined: [], pricingQuestionCount: 0 },
    state: { phase: "greeting", turn: 0, asked: {}, intent: "unknown", evidence: {}, questionsAsked: [] },
  };
}

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const pick = <T,>(arr: T[], i: number) => arr[Math.abs(i) % arr.length];

/** IST helpers (Aangan is in Pune; timestamps are stored in UTC). */
export function istParts(d: Date) {
  const ist = new Date(d.getTime() + 330 * 60_000);
  return { hour: ist.getUTCHours(), minute: ist.getUTCMinutes(), day: ist.getUTCDay(), date: ist.toISOString().slice(0, 10) };
}

export function isAfterHours(d: Date, s: TurnContext["settings"]): boolean {
  const { hour, day } = istParts(d);
  return !s.workingDays.includes(day) || hour < s.officeStartHour || hour >= s.officeEndHour;
}

function salutation(d: Date) {
  const { hour } = istParts(d);
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

export function greet(session: Session, ctx: TurnContext, opts: { repeatCaller?: boolean } = {}): TurnResult {
  const s = clone(session);
  const after = isAfterHours(ctx.now, ctx.settings);
  let reply: string;
  if (opts.repeatCaller) {
    const name = s.fields.callerName ? `, ${s.fields.callerName.split(" ")[0]}` : "";
    reply = `${salutation(ctx.now)}, Aangan Studio — welcome back${name}. You're speaking with the studio's virtual assistant; I have the details from your earlier call, so you won't need to repeat them. How can I help?`;
  } else {
    reply = `${salutation(ctx.now)}, thank you for calling Aangan Studio. You're speaking with the studio's virtual assistant${after ? " — the studio is closed right now, but I can take your enquiry straight away" : ""}. How can I help you today?`;
  }
  s.state.phase = "collecting";
  s.state.lastQuestion = "need";
  return { session: s, reply, qualification: qualify(s.fields, s.state.evidence, ctx.now), ended: false, question: "need", events: after ? ["after_hours"] : [] };
}

function merge(fields: EnquiryFields, add: Partial<EnquiryFields>, onlyFillGaps = false): EnquiryFields {
  const out: EnquiryFields = { ...fields };
  for (const [k, v] of Object.entries(add) as [keyof EnquiryFields, unknown][]) {
    if (v === undefined || v === null || v === "") continue;
    if (k === "rooms") {
      out.rooms = Array.from(new Set([...(out.rooms ?? []), ...(v as string[])]));
      continue;
    }
    if (onlyFillGaps && out[k] !== undefined) continue;
    (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

// ── Question bank (one question per turn, varied wording) ──────────────────────
function questionText(key: QuestionKey, f: EnquiryFields, turn: number): string {
  const commercial = f.projectCategory === "commercial";
  switch (key) {
    case "name":
      return pick(["May I have your name, please?", "Could I take your name, please?", "And who am I speaking with?"], turn);
    case "location":
      return pick(["Where is the property located?", "Which area is the property in?"], turn);
    case "location_confirm":
      return `Just to check — is ${f.location} within Pune city or PCMC?`;
    case "rooms":
      return commercial
        ? "What spaces do you need designed — for example workstations, cabins, a meeting room?"
        : pick(["Which rooms or spaces are you looking to redesign?", "Which parts of the home would you like to redo?"], turn);
    case "execution":
      return "Are you looking for us to handle both the design and the execution, or mainly ideas and advice?";
    case "property":
      if (commercial) return "Roughly how big is the space, in carpet area?";
      if (f.propertyType) return `Roughly what's the carpet area of the ${f.propertyType.replace(/ apartment$/, "")}?`;
      return "What type of property is it, and roughly what's the carpet area?";
    case "timeline":
      return "When would you need the project complete?"; // verbatim from qualified.md
    case "site":
      return commercial
        ? "What's the current state of the space — bare shell, or an existing fitout?"
        : "What's the current state of the home — new possession, or are you living there at the moment?";
    case "decision":
      return "Just so I can brief the designer properly — will you be making the decision on this, or should anyone else join the consultation?";
    case "contact":
      return "Is the number you're calling from the best one for the designer to reach you on?";
    case "referral":
      return "And may I ask how you heard about us?";
    case "consultation":
      return "Would you like me to book a free consultation with one of our designers? If you have a preferred day or time, just let me know.";
    case "complaint_details":
      return "Could you tell me which project this is about — the location and your designer's name — so the senior team has the full picture?";
    default:
      return "Is there anything else I can help you with?";
  }
}

function nextQuestion(f: EnquiryFields, st: AgentState, q: QualificationResult): QuestionKey | undefined {
  const asked = (k: QuestionKey) => (st.asked[k] ?? 0) > 0 || (f.declined ?? []).includes(k);
  const c = (id: number) => q.criteria.find((x) => x.id === id)!;
  const order: [QuestionKey, boolean][] = [
    ["name", !f.callerName],
    ["location", f.locationStatus === undefined],
    ["location_confirm", f.locationStatus === "unclear" && !!f.location],
    ["rooms", !f.rooms?.length && f.scopeType !== "design_and_execution"],
    ["execution", c(1).status === "unclear"],
    ["property", !f.carpetAreaSqft || (!f.propertyType && f.projectCategory !== "commercial")],
    ["timeline", c(3).status === "unclear"],
    ["rooms", !f.rooms?.length],
    ["site", !f.siteCondition],
    ["decision", !f.decisionMaker],
    ["contact", !f.phoneConfirmed],
    ["referral", !f.referralSource],
    ["consultation", f.consultationRequested === undefined],
  ];
  for (const [key, needed] of order) if (needed && !asked(key)) return key;
  return undefined;
}

// ── Caller-facing closing messages (no prices, ever) ───────────────────────────
function failureMessage(f: EnquiryFields, q: QualificationResult): string {
  const reasons = q.failed.map((id) => failureSentence(id, f, q));
  if (q.failed.length >= 2) return `Thank you for explaining all of that. ${reasons.join(" ")} ${DECLINE_LINE}`;
  return `${reasons[0]}`;
}

function failureSentence(id: number, f: EnquiryFields, q: QualificationResult): string {
  const loc = f.location ?? "that area";
  switch (id) {
    case 1:
      if (f.outOfScopeType)
        return `Thank you for thinking of us. ${f.outOfScopeType === "gym" ? "Gym and fitness spaces" : f.outOfScopeType === "restaurant" || f.outOfScopeType === "cafe" || f.outOfScopeType === "hotel" ? "Restaurant and hospitality interiors" : "Retail spaces"} are outside what we take on — we focus on homes and offices, and a specialist studio would serve you much better.`;
      if (f.projectCategory === "commercial" && f.carpetAreaSqft && f.carpetAreaSqft < 1000)
        return "Thank you for asking. A space that size is below the scale our design and execution team is set up for, so we couldn't do it justice at the quality we'd want to promise. A designer who specialises in smaller commercial spaces would be a better fit.";
      if (f.projectCategory === "commercial" && f.carpetAreaSqft)
        return "Thank you for asking. That's larger than the commercial projects we take on — we work on offices up to about three thousand square feet — so we wouldn't be the right fit for this one.";
      if (f.scopeType === "structural") return "We're interior designers rather than architects, so we don't take on structural work like moving walls.";
      return "We're a full-service studio, so our projects always include design and execution together — we don't offer advice-only or styling visits. If you decide to go ahead with a full redesign, we'd love to hear from you.";
    case 2:
      return `We currently only work in Pune city and PCMC — our execution depends on our own contractors being on site, so we're not able to take on a project in ${loc}. I'm sorry we can't help this time.`;
    case 3: {
      const c = q.criteria.find((x) => x.id === 3)!;
      if (/Site will only be available/.test(c.reason))
        return "Since the site won't be available for a while yet, the best time to start is closer to possession — please call us back then and we'll set up a consultation straight away.";
      return "I want to be honest with you: our design phase alone takes three to four weeks, and execution follows after that, so we couldn't do justice to a project on that timeline. If a later completion date works for you, we'd be glad to help — just let me know, or call us back whenever you're ready.";
    }
    case 4:
      return "I appreciate you sharing that. For the scope you've described — with materials, furniture and full execution — that budget would be significantly below what a project of this scope needs with us. I wouldn't want to bring you to a consultation if the numbers don't align; a local contractor who works at that price point may be a better fit.";
    case 5:
      return "Thank you for checking on their behalf. Before we arrange a consultation we'd need the owners to be on board — when they're ready to go ahead, they're welcome to call us directly, or you can call back once they've asked you to move forward.";
    default:
      return DECLINE_LINE;
  }
}

function qualifiedClosing(f: EnquiryFields): string {
  const name = f.callerName ? `, ${f.callerName.split(" ")[0]}` : "";
  const next = f.consultationRequested
    ? `They'll call you to confirm your consultation slot.${f.preferredSlot ? ` I've noted your preference: “${f.preferredSlot.replace(/[.!]+$/, "")}”.` : ""}`
    : "They'll be in touch to answer your questions and arrange a consultation whenever you're ready.";
  return `Thank you${name}. Here's what happens next: I'm passing your details to one of our designers now, so you won't need to repeat anything. ${next} Is there anything else I can help you with?`;
}

function awaitingClosing(f: EnquiryFields, q: QualificationResult): string {
  const name = f.callerName ? `, ${f.callerName.split(" ")[0]}` : "";
  const needs = q.unclear.map((id) => ({ 1: "the scope of work", 2: "the exact location", 3: "your timeline" } as Record<number, string>)[id]).filter(Boolean);
  return `Thank you${name} — I've noted everything you've shared. Before we set up a consultation, our team will need to confirm ${needs.join(" and ") || "a couple of details"} with you, and someone will follow up on this number. Is there anything else I can help with?`;
}

function contextualNote(prev: EnquiryFields, now: EnquiryFields): string | undefined {
  if (now.referralSource?.startsWith("Referral — ") && !prev.referralSource) return `Thank you for the referral from ${now.referralSource.replace("Referral — ", "").split(" ")[0]} — that means a lot to us.`;
  if (now.locationStatus === "in_area" && prev.locationStatus !== "in_area" && now.location && now.location !== "Pune" && now.location !== "PCMC")
    return `${now.location} is well within our service area.`;
  if (now.rented && !prev.rented) return "Rented homes are absolutely fine with us, as long as there are no structural changes.";
  if (now.structuralRequest && !prev.structuralRequest) return "Just so you know, we don't do structural work such as moving walls, but we design around the existing layout.";
  if (now.requiredByDate && now.requiredByDate !== prev.requiredByDate) return "That timeline works well for us.";
  if (now.timelineFlexible && !prev.timelineFlexible) return "That gives us good time to plan properly.";
  return undefined;
}

const ACKS = ["Thank you.", "Got it.", "That's helpful, thank you.", "Lovely.", "Perfect, noted.", "Understood."];

export function processCallerTurn(session: Session, utterance: string, ctx: TurnContext, aiFields?: Partial<EnquiryFields>): TurnResult {
  const s = clone(session);
  const st = s.state;
  const prev = clone(s.fields);
  const events: string[] = [];
  st.turn += 1;

  const ext = extract(utterance, st.lastQuestion, ctx.now, ctx.settings.festivalDates);
  s.fields = merge(s.fields, ext.fields);
  if (aiFields) s.fields = merge(s.fields, aiFields, true); // AI may only fill gaps
  st.evidence = { ...st.evidence, ...ext.evidence };
  if (ext.declinedToAnswer && st.lastQuestion) s.fields.declined = Array.from(new Set([...(s.fields.declined ?? []), st.lastQuestion]));
  if (ext.isPricingQuestion) {
    s.fields.pricingQuestionCount = (s.fields.pricingQuestionCount ?? 0) + 1;
    events.push("pricing_question");
  }

  // ── Complaint / existing client → human escalation, never a sales lead ─────
  if (ext.isComplaint || st.intent === "complaint") {
    const first = st.intent !== "complaint";
    st.intent = "complaint";
    s.fields.complaint = true;
    s.fields.complaintDetails = [s.fields.complaintDetails, utterance].filter(Boolean).join(" | ").slice(0, 600);
    if (first) events.push("escalated");
    return finishTurn(s, complaintReply(s, first), ctx, events);
  }
  if (st.intent === "unknown") st.intent = "new_enquiry";

  let q = qualify(s.fields, st.evidence, ctx.now);
  const parts: string[] = [];
  if (s.fields.missedCommitment && !prev.missedCommitment) {
    parts.push("I'm very sorry nobody got back to you — that shouldn't have happened. I'll make sure your details go straight to a designer this time.");
    events.push("missed_commitment");
  }

  // Already closed with a decline, and the new answer didn't change anything → polite goodbye.
  if (st.phase === "closing") {
    const reopened = (st.closeReason === "not_qualified" || st.closeReason === "declined") && q.failed.length === 0;
    if (reopened) {
      events.push("reopened");
      st.phase = "collecting";
      st.closeReason = undefined;
      parts.push("Thank you — with that, we'd be glad to help.");
    } else if (ext.isPricingQuestion) {
      events.push("pricing_deflected");
      st.lastQuestion = "consultation";
      return finishTurn(s, PRICING_SCRIPT, ctx, events);
    } else {
      st.phase = "ended";
      const name = s.fields.callerName ? `, ${s.fields.callerName.split(" ")[0]}` : "";
      return finishTurn(s, `Thank you for calling Aangan Studio${name}. Have a lovely day!`, ctx, events, true);
    }
  }

  // ── A criterion failed → close gracefully (qualified.md) ───────────────────
  if (q.failed.length > 0) {
    st.phase = "closing";
    st.closeReason = q.failed.length >= 2 ? "declined" : "not_qualified";
    st.lastQuestion = "anything_else";
    events.push(q.failed.length >= 2 ? "declined" : "not_qualified");
    parts.push(failureMessage(s.fields, q));
    return finishTurn(s, parts.join(" "), ctx, events);
  }

  const key = nextQuestion(s.fields, st, q);

  // ── Pricing question → approved script verbatim, never a number ────────────
  if (ext.isPricingQuestion) {
    events.push("pricing_deflected");
    parts.push(PRICING_SCRIPT);
    if (key && key !== "consultation") {
      parts.push(`Before I set that up — ${lowerFirst(questionText(key, s.fields, st.turn))}`);
      return ask(s, key, parts, ctx, events);
    }
    st.lastQuestion = "consultation";
    st.asked.consultation = (st.asked.consultation ?? 0) + 1;
    return finishTurn(s, parts.join(" "), ctx, events);
  }

  if (key) {
    const note = contextualNote(prev, s.fields);
    const unsure = /\b(not sure|don't know|do not know|haven't decided|undecided|no idea|still exploring)\b/i.test(utterance);
    if (events.includes("reopened")) {
      // already acknowledged above
    } else if (st.lastQuestion !== "need" || note) {
      // qualified.md: not knowing exactly what they want is the consultation's job — reassure, don't push.
      parts.push(ext.declinedToAnswer ? "No problem at all." : unsure ? "That's completely fine — working that out is exactly what the consultation is for." : pick(ACKS, st.turn));
    } else {
      const projectHeard = !!(ext.fields.rooms || ext.fields.propertyType || ext.fields.scopeType);
      parts.push(projectHeard ? pick(["That sounds like a lovely project.", "Thank you — that sounds like a great project."], st.turn) : pick(["Thank you for calling us.", "Thanks for reaching out."], st.turn));
    }
    if (note) parts.push(note);
    if (key === "execution" || key === "location_confirm" || key === "timeline") events.push(`clarification_asked:${key}`);
    return ask(s, key, parts, ctx, events);
  }

  // ── Nothing left to ask → close ─────────────────────────────────────────────
  q = qualify(s.fields, st.evidence, ctx.now);
  st.phase = "closing";
  st.lastQuestion = "anything_else";
  if (q.decision === "qualified") {
    st.closeReason = "qualified";
    events.push("qualified");
    parts.push(qualifiedClosing(s.fields));
  } else {
    st.closeReason = "awaiting_info";
    events.push("awaiting_info");
    parts.push(awaitingClosing(s.fields, q));
  }
  return finishTurn(s, parts.join(" "), ctx, events);
}

function complaintReply(s: Session, first: boolean): string {
  const st = s.state;
  const f = s.fields;
  const empathy = first ? "I'm really sorry to hear that — that's not the experience we want anyone to have. " : "";
  if (!f.callerName && !(st.asked.name ?? 0)) {
    st.asked.name = 1;
    st.lastQuestion = "name";
    st.questionsAsked.push("May I have your name, please?");
    return `${empathy}I'm flagging this as urgent for our studio head right now. May I have your name, please?`;
  }
  const hasDetails = /\b(designer|flat|project|site|bhk|apartment|nagar|road|park)\b/i.test(f.complaintDetails ?? "") && (f.complaintDetails ?? "").length > 60;
  if (!hasDetails && !(st.asked.complaint_details ?? 0)) {
    st.asked.complaint_details = 1;
    st.lastQuestion = "complaint_details";
    const qt = questionText("complaint_details", f, st.turn);
    st.questionsAsked.push(qt);
    return `${empathy}${f.callerName ? `Thank you, ${f.callerName.split(" ")[0]}. ` : ""}${qt}`;
  }
  if (st.phase !== "closing") {
    st.phase = "closing";
    st.closeReason = "escalated";
    st.lastQuestion = "anything_else";
    const senior = /\b(nikhil|senior|owner|manager|head)\b/i.test(f.complaintDetails ?? "") ? " I've also noted that you'd like to hear from Nikhil or someone senior." : "";
    return `${empathy}Thank you${f.callerName ? `, ${f.callerName.split(" ")[0]}` : ""}. I've marked this as urgent and passed everything you've told me to our studio head and senior team, so you won't need to repeat it, and asked for a senior team member to call you back as a priority.${senior} I can't make decisions about the project myself, but the right people now have the full details. Is there anything else you'd like me to add to the note?`;
  }
  st.phase = "ended";
  return "Thank you — I've added that to the note for the senior team. Goodbye for now.";
}

function lowerFirst(s: string) {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function ask(s: Session, key: QuestionKey, parts: string[], ctx: TurnContext, events: string[]): TurnResult {
  const text = parts[parts.length - 1]?.startsWith("Before I set that up") ? "" : questionText(key, s.fields, s.state.turn);
  if (text) parts.push(text);
  s.state.asked[key] = (s.state.asked[key] ?? 0) + 1;
  s.state.lastQuestion = key;
  s.state.questionsAsked.push(questionText(key, s.fields, s.state.turn));
  return finishTurn(s, parts.join(" "), ctx, events, false, key);
}

function finishTurn(s: Session, reply: string, ctx: TurnContext, events: string[], ended = false, question?: QuestionKey): TurnResult {
  const guarded = guardCallerReply(reply);
  if (guarded.blocked) events.push("price_guard_blocked");
  if (s.state.phase === "ended") ended = true;
  return { session: s, reply: guarded.text, qualification: qualify(s.fields, s.state.evidence, ctx.now), ended, question, events };
}

// ── Outcome at end of call ─────────────────────────────────────────────────────
export function finalOutcome(session: Session, now: Date): { status: EnquiryStatus; type: EnquiryType; qualification: QualificationResult; urgent: boolean } {
  const f = session.fields;
  const qualification = qualify(f, session.state.evidence, now);
  const type: EnquiryType = f.complaint ? "complaint" : f.projectCategory ?? "unknown";
  let status: EnquiryStatus;
  if (f.complaint) status = "escalated";
  else if (qualification.decision === "qualified") status = "qualified";
  else if (qualification.decision === "declined" || qualification.decision === "not_qualified") status = "not_qualified";
  else status = "awaiting_info";
  return { status, type, qualification, urgent: !!f.complaint || !!f.missedCommitment };
}

/** Information still missing, for the designer handoff. */
export function outstandingItems(f: EnquiryFields, q: QualificationResult): string[] {
  const out: string[] = [];
  if (!f.callerName) out.push("Caller name not captured");
  if (!f.carpetAreaSqft) out.push("Carpet area not confirmed");
  if (!f.siteCondition) out.push("Current site condition not confirmed");
  if (!f.rooms?.length) out.push("Rooms / spaces in scope not confirmed");
  if (!f.requiredByDate && !f.timelineFlexible) out.push("Completion date not confirmed");
  if (!f.referralSource) out.push("Referral source unknown");
  if ((f.pricingQuestionCount ?? 0) > 0) out.push("Caller asked about pricing — deflected per policy; walk them through it at consultation");
  for (const id of q.unclear) out.push(`Unclear: ${CRITERIA_NAMES[id]}`);
  for (const u of q.uncertainties) out.push(u);
  for (const d of f.declined ?? []) out.push(`Caller preferred not to answer: ${d}`);
  return out;
}
