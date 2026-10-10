/** Integrations: Telegram, HubSpot, Resend, Calendly — with fetch stubbed (no real network calls). */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { sendEmail } from "@/lib/email/mailer";
import { integrationEvents, integrationStatus } from "@/lib/integrations";
import { answerCall, callerSays, endCall, enquiryDetail, startCall } from "@/lib/service";

type Req = { url: string; body: Record<string, unknown> };

function stubFetch(handler: (url: string) => { status?: number; json: unknown }) {
  const calls: Req[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : {} });
    const r = handler(url);
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: { "Content-Type": "application/json" } });
  });
  return calls;
}

const env = (vars: Record<string, string>) => {
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
};

/** Play a short live (non-demo) call through the real service. */
async function liveCall(phone: string, lines: string[]) {
  const t0 = new Date("2026-10-10T08:00:00Z");
  const s = await startCall({ phone, provider: "vaani", isDemo: false }, { at: t0 });
  await answerCall(s.callId, { at: new Date(t0.getTime() + 1000) });
  let t = t0.getTime() + 2000;
  for (const l of lines) await callerSays(s.callId, l, { at: new Date((t += 15000)) });
  await endCall(s.callId, "completed", { at: new Date(t + 5000) });
  return s.enquiryId;
}

const QUALIFIED = [
  "Hi, I'm Leela Rao. We have a 3BHK in Baner, about 1,250 sq ft, and want a full redesign -- kitchen, living room and bedrooms.",
  "We'd like it done by March.",
  "We're living there now.",
  "Yes, I'm the owner.",
  "Yes.",
  "Instagram.",
  "Yes please.",
];
const COMPLAINT = [
  "My project has been going for three months and my designer hasn't replied in five days. This is not acceptable.",
  "Sheetal Deshpande.",
  "No, that's all.",
];

beforeAll(async () => {
  await getDb();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("integrations", () => {
  it("are all reported as not configured by default", () => {
    expect(integrationStatus().every((i) => !i.configured)).toBe(true);
  });

  it("HubSpot: a qualified live lead creates a contact and an associated deal", async () => {
    env({ HUBSPOT_ACCESS_TOKEN: "test-token" });
    const calls = stubFetch((url) => (url.includes("/search") ? { json: { results: [] } } : url.includes("/contacts") ? { json: { id: "c-1" } } : { json: { id: "d-1" } }));
    const id = await liveCall("+91 98765 00001", QUALIFIED);
    const contact = calls.find((c) => c.url.endsWith("/crm/v3/objects/contacts"))!;
    expect((contact.body.properties as Record<string, string>).phone).toBe("+919876500001");
    const deal = calls.find((c) => c.url.endsWith("/crm/v3/objects/deals"))!;
    expect(String((deal.body.properties as Record<string, string>).dealname)).toMatch(/Leela/);
    expect(JSON.stringify(deal.body.associations)).toContain("c-1");
    const ev = await integrationEvents(id);
    expect(ev.find((e) => e.integration === "hubspot")?.status).toBe("ok");
  });

  it("Telegram: an escalated complaint sends an urgent alert; HubSpot is NOT used for complaints", async () => {
    env({ TELEGRAM_BOT_TOKEN: "bot", TELEGRAM_CHAT_ID: "123", HUBSPOT_ACCESS_TOKEN: "test-token" });
    const calls = stubFetch(() => ({ json: { ok: true } }));
    const id = await liveCall("+91 98765 00002", COMPLAINT);
    const tg = calls.filter((c) => c.url.includes("api.telegram.org"));
    expect(tg).toHaveLength(1);
    expect(String(tg[0].body.text)).toMatch(/complaint/i);
    expect(calls.some((c) => c.url.includes("hubapi"))).toBe(false);
    expect((await integrationEvents(id))[0]).toMatchObject({ integration: "telegram", status: "ok" });
  });

  it("demo calls never trigger integrations", async () => {
    env({ TELEGRAM_BOT_TOKEN: "bot", TELEGRAM_CHAT_ID: "123", HUBSPOT_ACCESS_TOKEN: "test-token" });
    const calls = stubFetch(() => ({ json: { ok: true, id: "x" } }));
    const t0 = new Date("2026-10-10T09:00:00Z");
    const s = await startCall({ phone: "+91 98765 00003", isDemo: true }, { at: t0 });
    await answerCall(s.callId, { at: t0 });
    for (const l of COMPLAINT) await callerSays(s.callId, l, { at: t0 });
    await endCall(s.callId, "completed", { at: t0 });
    expect(calls).toHaveLength(0);
  });

  it("an integration failure is logged and never breaks the call", async () => {
    env({ HUBSPOT_ACCESS_TOKEN: "bad-token" });
    stubFetch(() => ({ status: 401, json: { message: "Authentication credentials not found" } }));
    const id = await liveCall("+91 98765 00004", QUALIFIED);
    const d = await enquiryDetail(id);
    expect(d?.enquiry.status).toBe("qualified");
    expect(d?.integrations[0]).toMatchObject({ integration: "hubspot", status: "failed" });
    expect(d?.integrations[0].detail).toMatch(/401/);
  });

  it("live calls keep the full number for the designer; demo calls do not", async () => {
    stubFetch(() => ({ json: {} }));
    const id = await liveCall("+91 98765 00005", QUALIFIED);
    const d = await enquiryDetail(id);
    expect(d?.enquiry.phone_e164).toBe("+919876500005");
    expect(d?.handoffs[0].body_text).toContain("+919876500005");
    const demo = await (await getDb()).get<{ n: number }>("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM enquiries WHERE is_demo = 1 AND phone_e164 IS NOT NULL");
    expect(Number(demo?.n)).toBe(0);
  });

  it("Calendly: the booking link appears in the designer handoff", async () => {
    env({ CALENDLY_URL: "https://calendly.com/aangan-studio/consultation" });
    stubFetch(() => ({ json: {} }));
    const id = await liveCall("+91 98765 00006", QUALIFIED);
    const d = await enquiryDetail(id);
    expect(d?.handoffs[0].body_text).toContain("https://calendly.com/aangan-studio/consultation");
  });

  it("Resend: sends through the API and reports 'sent' only on success", async () => {
    env({ RESEND_API_KEY: "re_test" });
    const calls = stubFetch(() => ({ json: { id: "email-1" } }));
    const r = await sendEmail({ id: "m1", to: "designers@example.com", subject: "s", text: "t", html: "<p>t</p>" });
    expect(r).toMatchObject({ status: "sent", provider: "resend:email-1" });
    expect(calls[0].url).toBe("https://api.resend.com/emails");

    stubFetch(() => ({ status: 403, json: { message: "domain not verified" } }));
    const bad = await sendEmail({ id: "m2", to: "designers@example.com", subject: "s", text: "t", html: "<p>t</p>" });
    expect(bad.status).toBe("failed");
    expect(bad.error).toMatch(/domain not verified/);
  });
});
