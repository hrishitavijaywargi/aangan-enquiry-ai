/**
 * End-to-end over the real service + in-memory SQLite: dedupe, dashboard maths from stored
 * records, handoffs, email without credentials, AI without a key, settings validation.
 */
import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aiStatus, getAIProvider } from "@/lib/ai/provider";
import { dashboard, listHandoffs, loadAll } from "@/lib/data";
import { closeDb, count as dbCount, getDb } from "@/lib/db";
import { emailConfigProblem, sendEmail } from "@/lib/email/mailer";
import { computeDashboard, type MCall, type MEnquiry, type MUsage } from "@/lib/metrics";
import { resetDemoData } from "@/lib/seed/seed";
import { answerCall, callerSays, deliverHandoff, endCall, startCall } from "@/lib/service";
import { DEFAULT_SETTINGS, getSettings, updateSettings } from "@/lib/settings";
import { telephonyStatus } from "@/lib/telephony";

beforeAll(async () => {
  await closeDb();
  await resetDemoData();
});
afterAll(async () => { await closeDb(); });

const count = (sql: string, ...p: (string | number)[]) => dbCount(sql.replace("COUNT(*) n", "CAST(COUNT(*) AS INTEGER) AS n"), ...p);

describe("dashboard is calculated from stored records", () => {
  it("totals match the database exactly", async () => {
    const m = (await dashboard({}));
    expect(m.total).toBe(await count("SELECT COUNT(*) n FROM enquiries"));
    expect(m.qualified).toBe(await count("SELECT COUNT(*) n FROM enquiries WHERE status='qualified'"));
    expect(m.notQualified).toBe(await count("SELECT COUNT(*) n FROM enquiries WHERE status='not_qualified'"));
    expect(m.awaiting).toBe(await count("SELECT COUNT(*) n FROM enquiries WHERE status='awaiting_info'"));
    expect(m.escalated).toBe(await count("SELECT COUNT(*) n FROM enquiries WHERE status='escalated'"));
    expect(m.calls).toBe(await count("SELECT COUNT(*) n FROM calls"));
  });

  it("filters by status, type and date range", async () => {
    expect((await dashboard({ status: "qualified" })).total).toBe((await dashboard({})).qualified);
    expect((await dashboard({ type: "commercial" })).total).toBe(await count("SELECT COUNT(*) n FROM enquiries WHERE enquiry_type='commercial'"));
    expect((await dashboard({ from: "2026-09-01", to: "2026-09-05" })).total).toBeLessThan((await dashboard({})).total);
    expect((await dashboard({ from: "2027-01-01" })).total).toBe(0);
  });

  it("conversion data that was never recorded is reported as unavailable (null), not zero", async () => {
    const m = (await dashboard({}));
    expect(m.projectsWon).toBeNull();
    expect(m.consultationsCompleted).toBeNull();
  });

  it("response-time metrics come from measured answer times", async () => {
    const m = (await dashboard({}));
    const rows = await (await getDb()).all("SELECT first_response_seconds s FROM enquiries") as { s: number }[];
    const avg = rows.reduce((a, r) => a + r.s, 0) / rows.length;
    expect(m.avgResponseSeconds).toBeCloseTo(avg, 6);
    expect(m.pctWithin5Min).toBe(100);
  });
});

describe("repeat calls are not double-counted", () => {
  it("Ritu's dropped call and call-back are one enquiry with two calls", async () => {
    const rows = await (await getDb()).all("SELECT call_count, status FROM enquiries WHERE scenario_key LIKE 't17-%'") as { call_count: number; status: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].call_count).toBe(2);
    expect(rows[0].status).toBe("qualified");
  });

  it("Girish's repeat call merges and is flagged as a missed commitment", async () => {
    const rows = await (await getDb()).all("SELECT call_count, urgent, status FROM enquiries WHERE scenario_key LIKE 't16-%'") as { call_count: number; urgent: number; status: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ call_count: 2, urgent: 1, status: "qualified" });
  });

  it("a new simulated call from the same number within the window reuses the enquiry", async () => {
    const before = await count("SELECT COUNT(*) n FROM enquiries");
    const at = new Date("2026-09-03T10:00:00Z");
    const a = await startCall({ phone: "+91 90000 10001" }, { at }); // Priya's number, T01 was 2 Sep
    expect(a.repeatCaller).toBe(true);
    await answerCall(a.callId, { at: new Date(at.getTime() + 3000) });
    await endCall(a.callId, "caller_hung_up", { at: new Date(at.getTime() + 20000) });
    expect(await count("SELECT COUNT(*) n FROM enquiries")).toBe(before);
  });
});

describe("full simulated call through the service", () => {
  it("records transcript, measured response time, qualification and an email handoff", async () => {
    const t0 = new Date("2026-10-10T08:00:00Z");
    const s = await startCall({ phone: "+91 90000 99999" }, { at: t0 });
    const a = await answerCall(s.callId, { at: new Date(t0.getTime() + 4000) });
    expect(a.responseSeconds).toBe(4);
    const lines = [
      "Hi, I'm Leela. We have a 3BHK in Baner, about 1,250 sq ft, and want a full redesign -- kitchen, living room and bedrooms.",
      "We'd like it done by March.",
      "We're living there now.",
      "Yes, I'm the owner.",
      "Yes.",
      "Instagram.",
      "Yes please, Saturday morning.",
    ];
    let t = t0.getTime() + 5000;
    for (const l of lines) await callerSays(s.callId, l, { at: new Date((t += 20000)) });
    const e = await endCall(s.callId, "completed", { at: new Date(t + 5000) });
    expect(e.status).toBe("qualified");
    const h = (await listHandoffs()).find((x) => x.enquiry_id === s.enquiryId)!;
    expect(h.kind).toBe("qualified_lead");
    for (const section of ["Contact", "Project type", "Location", "Carpet area", "Scope", "Site readiness", "Timeline", "Budget", "Decision-maker", "Qualification", "Missing information", "Call summary", "Recommended next action"]) {
      expect(h.body_text).toContain(section);
    }
    expect(h.body_text).toMatch(/Not mentioned \(not probed/);
    expect(h.status).not.toBe("sent"); // no SMTP configured in tests
  });

  it("complaints produce an escalation note to the studio head, not a lead", async () => {
    const h = (await listHandoffs()).find((x) => x.kind === "escalation")!;
    expect(h.subject).toMatch(/URGENT/);
    expect(h.to_address).toBe("studio-head@example.com");
    expect(h.body_text).toMatch(/Do not treat as a sales lead/);
  });
});

describe("operating-cost calculations", () => {
  const e = (id: string, status: string, day: string, resp: number): MEnquiry => ({
    id, created_at: `${day}T06:00:00Z`, status, enquiry_type: "residential", after_hours: 0, urgent: 0, is_demo: 1,
    first_response_seconds: resp, consultation_requested: 1, consultation_status: "unknown", project_outcome: "unknown", call_count: 1,
  });
  const enquiries = [e("a", "qualified", "2026-09-01", 4), e("b", "not_qualified", "2026-09-10", 6), e("c", "qualified", "2026-09-30", 400)];
  const calls: MCall[] = [
    { id: "c1", enquiry_id: "a", ring_at: "2026-09-01T06:00:00Z", duration_seconds: 125, response_seconds: 4, status: "completed", provider: "demo" }, // 3 billed min
    { id: "c2", enquiry_id: "b", ring_at: "2026-09-10T06:00:00Z", duration_seconds: 60, response_seconds: 6, status: "completed", provider: "demo" }, // 1 min
    { id: "c3", enquiry_id: "c", ring_at: "2026-09-30T06:00:00Z", duration_seconds: 0, response_seconds: 400, status: "dropped", provider: "demo" }, // 0 min
  ];
  const usage: MUsage[] = [
    { enquiry_id: "a", call_id: "c1", at: "2026-09-01T06:00:00Z", provider: "anthropic", model: "m", input_tokens: 1_000_000, output_tokens: 0, is_estimate: 0 },
    { enquiry_id: "b", call_id: "c2", at: "2026-09-10T06:00:00Z", provider: "mock", model: "m", input_tokens: 0, output_tokens: 100_000, is_estimate: 1 },
  ];
  const s = { ...DEFAULT_SETTINGS, usdToInr: 100, aiInputUsdPerMTok: 4, aiOutputUsdPerMTok: 20, telephonyInrPerMinute: 2, emailInrPerMessage: 1, recurring: [{ label: "x", inrPerMonth: 3044 }], expectedMonthlyEnquiries: 200 };
  const m = computeDashboard(enquiries, calls, usage, [{ enquiry_id: "a", status: "sent", created_at: "2026-09-01T06:00:00Z" }, { enquiry_id: "c", status: "saved_locally", created_at: "2026-09-30T06:00:00Z" }], s, {});

  it("separates recorded AI cost from projected (mock) estimates", async () => {
    expect(m.costs.aiRecordedInr).toBeCloseTo(400); // 1M input × $4 × ₹100
    expect(m.costs.aiProjectedInr).toBeCloseTo(200); // 0.1M output × $20 × ₹100
    expect(m.costs.tokensAreEstimates).toBe(false);
  });
  it("telephony = billed minutes (rounded up per call) × rate", async () => {
    expect(m.costs.billedMinutes).toBe(4);
    expect(m.costs.telephonyInr).toBe(8);
  });
  it("email cost counts only emails actually sent", async () => {
    expect(m.costs.emailsSent).toBe(1);
    expect(m.costs.emailInr).toBe(1);
  });
  it("recurring costs are pro-rated over the period (30 days here)", async () => {
    expect(m.costs.periodDays).toBe(30);
    expect(m.costs.recurringProratedInr).toBeCloseTo(3000, 0);
  });
  it("totals, cost per enquiry and per qualified enquiry", async () => {
    const total = 400 + 200 + 8 + 1 + 3044 * (30 / 30.44);
    expect(m.costs.totalInr).toBeCloseTo(total, 6);
    expect(m.costPerEnquiry).toBeCloseTo(total / 3, 6);
    expect(m.costPerQualified).toBeCloseTo(total / 2, 6);
    expect(m.projectedMonthlyInr).toBeCloseTo((609 / 3) * 200 + 3044, 6);
  });
  it("response-time stats", async () => {
    expect(m.avgResponseSeconds).toBeCloseTo((4 + 6 + 400) / 3);
    expect(m.pctWithin5Min).toBeCloseTo((2 / 3) * 100);
  });
  it("cost per qualified enquiry is unavailable when nothing qualified", async () => {
    const none = computeDashboard([e("z", "not_qualified", "2026-09-01", 3)], [], [], [], s, {});
    expect(none.costPerQualified).toBeNull();
  });
});

describe("missing credentials are handled safely", () => {
  it("no SMTP → explicit config problem, email saved locally and NOT reported as sent", async () => {
    expect(emailConfigProblem()).toMatch(/not configured/);
    const r = await sendEmail({ id: "test-msg", to: "a@example.com", subject: "s", text: "t", html: "<p>t</p>" });
    expect(r.status).toBe("saved_locally");
    expect(r.error).toMatch(/NOT sent/);
    expect(fs.existsSync(r.emlPath!)).toBe(true);
  });

  it("delivering a handoff without SMTP leaves it saved locally with the reason", async () => {
    const h = (await listHandoffs())[0];
    const d = await deliverHandoff(h.id);
    expect(d.status).toBe("saved_locally");
    expect(d.sent_at).toBeNull();
    expect(d.error).toMatch(/SMTP_HOST is not set/);
  });

  it("SMTP user without password is reported as a problem", async () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_USER = "me";
    process.env.SMTP_PASS = "";
    try {
      expect(emailConfigProblem()).toMatch(/SMTP_PASS is missing/);
    } finally {
      process.env.SMTP_HOST = "";
      process.env.SMTP_USER = "";
    }
  });

  it("AI_PROVIDER=anthropic without a key falls back to the mock with a clear message", async () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "";
    try {
      const s = aiStatus();
      expect(s.live).toBe(false);
      expect(s.message).toMatch(/ANTHROPIC_API_KEY is missing/);
      expect(getAIProvider().name).toBe("mock");
    } finally {
      process.env.AI_PROVIDER = "mock";
    }
  });

  it("mock AI usage is stored as an estimate, never as real usage", async () => {
    const { usage } = (await loadAll());
    expect(usage.length).toBeGreaterThan(0);
    expect(usage.every((u) => u.is_estimate === 1 && u.provider === "mock")).toBe(true);
  });

  it("Twilio without an auth token stays disabled; demo mode makes no real-call claims", async () => {
    expect(telephonyStatus().message).toMatch(/simulated/);
    process.env.TELEPHONY_PROVIDER = "twilio";
    try {
      expect(telephonyStatus().live).toBe(false);
    } finally {
      process.env.TELEPHONY_PROVIDER = "demo";
    }
  });
});

describe("settings", () => {
  it("rejects invalid values", async () => {
    await expect(updateSettings({ telephonyInrPerMinute: -1 })).rejects.toThrow(/non-negative/);
    await expect(updateSettings({ recurring: [{ label: "", inrPerMonth: 5 }] })).rejects.toThrow();
  });
  it("persists valid values that change the cost maths", async () => {
    const before = (await dashboard({})).costs.telephonyInr;
    await updateSettings({ telephonyInrPerMinute: (await getSettings()).telephonyInrPerMinute * 2 });
    expect((await dashboard({})).costs.telephonyInr).toBeCloseTo(before * 2, 6);
  });
});
