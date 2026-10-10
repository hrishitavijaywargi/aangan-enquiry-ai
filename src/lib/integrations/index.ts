/**
 * Optional third-party integrations. Each is OFF until its environment variable is set, never
 * blocks a call, and logs what it did (or why it didn't) to `integration_events`, shown on the
 * enquiry page. Demo/seeded enquiries are skipped unless INTEGRATIONS_INCLUDE_DEMO=true, so demo
 * data never spams a real CRM or phone.
 *
 *  - Telegram  (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID): instant alert for urgent cases
 *               (complaints / missed follow-ups). The full handoff still goes by email.
 *  - HubSpot   (HUBSPOT_ACCESS_TOKEN): contact + deal for qualified leads (CRM / conversion tracking).
 *  - Calendly  (CALENDLY_URL): booking link included in the designer handoff.
 *  - Resend    (RESEND_API_KEY): email delivery — see email/mailer.ts.
 */
import { getDb } from "../db";
import type { EnquiryFields, QualificationResult } from "../types";

export interface IntegrationInfo {
  key: "resend" | "telegram" | "hubspot" | "calendly";
  name: string;
  configured: boolean;
  purpose: string;
  message: string;
}

export function integrationStatus(): IntegrationInfo[] {
  const e = process.env;
  return [
    {
      key: "resend",
      name: "Resend (email)",
      configured: !!e.RESEND_API_KEY,
      purpose: "Delivers designer handoffs and escalation emails",
      message: e.RESEND_API_KEY ? `Sending from ${e.EMAIL_FROM || "(EMAIL_FROM not set — using onboarding@resend.dev)"}` : "Set RESEND_API_KEY (and EMAIL_FROM on a verified domain) to send real email",
    },
    {
      key: "telegram",
      name: "Telegram (urgent alerts)",
      configured: !!(e.TELEGRAM_BOT_TOKEN && e.TELEGRAM_CHAT_ID),
      purpose: "Instant ping to the studio head for complaints and missed follow-ups",
      message: e.TELEGRAM_BOT_TOKEN && e.TELEGRAM_CHAT_ID ? "Alerts go to the configured chat" : "Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID",
    },
    {
      key: "hubspot",
      name: "HubSpot (CRM)",
      configured: !!e.HUBSPOT_ACCESS_TOKEN,
      purpose: "Creates a contact + deal for every qualified lead, for pipeline and conversion tracking",
      message: e.HUBSPOT_ACCESS_TOKEN ? "Qualified leads are pushed to HubSpot" : "Set HUBSPOT_ACCESS_TOKEN (private app with crm.objects.contacts/deals write scopes)",
    },
    {
      key: "calendly",
      name: "Calendly (booking link)",
      configured: !!e.CALENDLY_URL,
      purpose: "Booking link in the designer's handoff email, to send the client",
      message: e.CALENDLY_URL ? `Link: ${e.CALENDLY_URL}` : "Set CALENDLY_URL to your studio's Calendly scheduling link",
    },
  ];
}

export const calendlyUrl = () => process.env.CALENDLY_URL?.trim() || undefined;

async function logEvent(enquiryId: string, integration: string, action: string, status: "ok" | "skipped" | "failed", detail: string) {
  await (await getDb()).run(
    "INSERT INTO integration_events(enquiry_id, at, integration, action, status, detail) VALUES(?, ?, ?, ?, ?, ?)",
    enquiryId, new Date().toISOString(), integration, action, status, detail.slice(0, 500),
  );
}

// ── Telegram ─────────────────────────────────────────────────────────────────
export async function sendTelegram(text: string): Promise<{ ok: boolean; detail: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return { ok: false, detail: "Telegram not configured" };
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
  });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; description?: string };
  return j.ok ? { ok: true, detail: "Alert sent" } : { ok: false, detail: `Telegram error: ${j.description ?? r.status}` };
}

// ── HubSpot ──────────────────────────────────────────────────────────────────
async function hubspot(path: string, body: unknown) {
  const r = await fetch(`https://api.hubapi.com${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as { id?: string; results?: { id: string }[]; message?: string };
  if (!r.ok) throw new Error(`HubSpot ${r.status}: ${j.message ?? "request failed"}`);
  return j;
}

export async function pushToHubSpot(input: { ref: string; phone?: string; fields: EnquiryFields; summary: string }) {
  const f = input.fields;
  const [first, ...rest] = (f.callerName ?? "Aangan caller").split(/\s+/);
  let contactId: string | undefined;
  if (input.phone) {
    const found = await hubspot("/crm/v3/objects/contacts/search", { filterGroups: [{ filters: [{ propertyName: "phone", operator: "EQ", value: input.phone }] }], limit: 1 });
    contactId = found.results?.[0]?.id;
  }
  if (!contactId) {
    const c = await hubspot("/crm/v3/objects/contacts", {
      properties: { firstname: first, lastname: rest.join(" "), ...(input.phone ? { phone: input.phone } : {}), city: f.location ?? "", lifecyclestage: "lead" },
    });
    contactId = c.id;
  }
  const deal = await hubspot("/crm/v3/objects/deals", {
    properties: {
      dealname: `${input.ref} · ${f.callerName ?? "Caller"} · ${[f.propertyType, f.location].filter(Boolean).join(", ")}`,
      pipeline: "default",
      dealstage: "appointmentscheduled",
      description: input.summary.slice(0, 1000),
    },
    associations: contactId ? [{ to: { id: contactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 3 }] }] : [],
  });
  return { contactId, dealId: deal.id };
}

// ── After-call hook ──────────────────────────────────────────────────────────
export interface AfterCallInput {
  enquiryId: string;
  ref: string;
  status: string;
  urgent: boolean;
  isDemo: boolean;
  phone?: string;
  fields: EnquiryFields;
  qualification: QualificationResult;
  summary: string;
}

/** Runs every configured integration for a finished call. Never throws. */
export async function runAfterCall(x: AfterCallInput) {
  if (x.isDemo && process.env.INTEGRATIONS_INCLUDE_DEMO !== "true") return;
  const name = x.fields.callerName ?? "Unknown caller";

  // Telegram: urgent only (escalations, missed commitments). Email remains the full record.
  if (x.urgent && process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    const what = x.fields.complaint ? "Existing-client complaint" : x.fields.missedCommitment ? "Lead says nobody followed up" : "Urgent enquiry";
    const text = `🚨 Aangan ${x.ref} — ${what}\nCaller: ${name}${x.phone ? ` (${x.phone})` : ""}\n${(x.fields.complaintDetails ?? x.summary).slice(0, 300)}\nFull note is in the escalation email. Please call back today.`;
    try {
      const r = await sendTelegram(text);
      await logEvent(x.enquiryId, "telegram", "urgent_alert", r.ok ? "ok" : "failed", r.detail);
    } catch (e) {
      await logEvent(x.enquiryId, "telegram", "urgent_alert", "failed", (e as Error).message);
    }
  }

  // HubSpot: qualified leads only (complaints are existing clients, not new pipeline).
  if (x.status === "qualified" && process.env.HUBSPOT_ACCESS_TOKEN) {
    try {
      const r = await pushToHubSpot({ ref: x.ref, phone: x.phone, fields: x.fields, summary: x.summary });
      await logEvent(x.enquiryId, "hubspot", "contact_and_deal", "ok", `contact ${r.contactId}, deal ${r.dealId}`);
    } catch (e) {
      await logEvent(x.enquiryId, "hubspot", "contact_and_deal", "failed", (e as Error).message);
    }
  }
}

export async function integrationEvents(enquiryId: string) {
  return (await getDb()).all<{ id: number; at: string; integration: string; action: string; status: string; detail: string | null }>(
    "SELECT * FROM integration_events WHERE enquiry_id = ? ORDER BY id",
    enquiryId,
  );
}
