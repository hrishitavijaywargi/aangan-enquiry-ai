/**
 * Dashboard & cost calculations. Pure functions over stored rows — nothing here is hardcoded.
 * Every cost figure is tagged with its provenance: "recorded" (from an API response / actual
 * delivery) vs "estimated" (configured rate × recorded usage) vs "projected" (mock-mode token estimate).
 */
import type { Settings } from "./types";

export interface MEnquiry {
  id: string;
  created_at: string;
  status: string;
  enquiry_type: string;
  after_hours: number;
  urgent: number;
  is_demo: number;
  first_response_seconds: number | null;
  consultation_requested: number | null;
  consultation_status: string;
  project_outcome: string;
  call_count: number;
}
export interface MCall {
  id: string;
  enquiry_id: string;
  ring_at: string;
  duration_seconds: number | null;
  response_seconds: number | null;
  status: string;
  provider: string;
}
export interface MUsage {
  enquiry_id: string | null;
  call_id: string | null;
  at: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  is_estimate: number;
}
export interface MHandoff {
  enquiry_id: string;
  status: string;
  created_at: string;
}

export interface Filters {
  from?: string; // YYYY-MM-DD (inclusive, IST calendar day)
  to?: string; // YYYY-MM-DD (inclusive)
  status?: string;
  type?: string;
}

export const istDate = (iso: string) => new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 10);

export function applyFilters<T extends MEnquiry>(rows: T[], f: Filters): T[] {
  return rows.filter((r) => {
    const d = istDate(r.created_at);
    if (f.from && d < f.from) return false;
    if (f.to && d > f.to) return false;
    if (f.status && f.status !== "all" && r.status !== f.status) return false;
    if (f.type && f.type !== "all" && r.enquiry_type !== f.type) return false;
    return true;
  });
}

export const aiCostUsd = (u: Pick<MUsage, "input_tokens" | "output_tokens">, s: Pick<Settings, "aiInputUsdPerMTok" | "aiOutputUsdPerMTok">) =>
  (u.input_tokens / 1e6) * s.aiInputUsdPerMTok + (u.output_tokens / 1e6) * s.aiOutputUsdPerMTok;

export const billedMinutes = (seconds: number | null) => (seconds && seconds > 0 ? Math.ceil(seconds / 60) : 0);

export const monthlyRecurringInr = (s: Pick<Settings, "recurring">) => s.recurring.reduce((a, r) => a + r.inrPerMonth, 0);

const DAYS_PER_MONTH = 30.44;

function daySpan(rows: MEnquiry[], f: Filters): number {
  const start = f.from ?? (rows.length ? rows.map((r) => istDate(r.created_at)).sort()[0] : undefined);
  const end = f.to ?? (rows.length ? rows.map((r) => istDate(r.created_at)).sort().slice(-1)[0] : undefined);
  if (!start || !end) return 0;
  return Math.max(1, Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1);
}

export interface CostBreakdown {
  aiInr: number;
  aiRecordedInr: number; // from real API token counts
  aiProjectedInr: number; // mock-mode token estimates
  inputTokens: number;
  outputTokens: number;
  tokensAreEstimates: boolean;
  liveAiCalls: number;
  telephonyInr: number; // estimated: billed minutes × configured rate
  billedMinutes: number;
  emailInr: number;
  emailsSent: number;
  recurringProratedInr: number;
  recurringMonthlyInr: number;
  periodDays: number;
  variableInr: number;
  totalInr: number;
}

export function computeCosts(enquiries: MEnquiry[], calls: MCall[], usage: MUsage[], handoffs: MHandoff[], s: Settings, f: Filters): CostBreakdown {
  const ids = new Set(enquiries.map((e) => e.id));
  const u = usage.filter((x) => x.enquiry_id && ids.has(x.enquiry_id));
  const c = calls.filter((x) => ids.has(x.enquiry_id));
  const h = handoffs.filter((x) => ids.has(x.enquiry_id));
  const fx = s.usdToInr;
  const recorded = u.filter((x) => !x.is_estimate);
  const projected = u.filter((x) => x.is_estimate);
  const aiRecordedInr = recorded.reduce((a, x) => a + aiCostUsd(x, s) * fx, 0);
  const aiProjectedInr = projected.reduce((a, x) => a + aiCostUsd(x, s) * fx, 0);
  const minutes = c.reduce((a, x) => a + billedMinutes(x.duration_seconds), 0);
  const telephonyInr = minutes * s.telephonyInrPerMinute;
  const emailsSent = h.filter((x) => x.status === "sent").length;
  const emailInr = emailsSent * s.emailInrPerMessage;
  const periodDays = daySpan(enquiries, f);
  const recurringMonthlyInr = monthlyRecurringInr(s);
  const recurringProratedInr = (recurringMonthlyInr * periodDays) / DAYS_PER_MONTH;
  const variableInr = aiRecordedInr + aiProjectedInr + telephonyInr + emailInr;
  return {
    aiInr: aiRecordedInr + aiProjectedInr,
    aiRecordedInr,
    aiProjectedInr,
    inputTokens: u.reduce((a, x) => a + x.input_tokens, 0),
    outputTokens: u.reduce((a, x) => a + x.output_tokens, 0),
    tokensAreEstimates: recorded.length === 0 && projected.length > 0,
    liveAiCalls: recorded.length,
    telephonyInr,
    billedMinutes: minutes,
    emailInr,
    emailsSent,
    recurringProratedInr,
    recurringMonthlyInr,
    periodDays,
    variableInr,
    totalInr: variableInr + recurringProratedInr,
  };
}

export interface DashboardMetrics {
  total: number;
  qualified: number;
  notQualified: number;
  awaiting: number;
  escalated: number;
  inProgress: number;
  calls: number;
  repeatCallsMerged: number;
  afterHours: number;
  urgent: number;
  avgResponseSeconds: number | null;
  pctWithin5Min: number | null;
  answeredCount: number;
  consultationsRequested: number;
  consultationsCompleted: number | null; // null = not recorded yet → "Unavailable"
  projectsWon: number | null;
  outcomesRecorded: number;
  demoCount: number;
  liveCount: number;
  costs: CostBreakdown;
  costPerEnquiry: number | null;
  costPerQualified: number | null;
  projectedMonthlyInr: number | null;
  series: { date: string; total: number; qualified: number; not_qualified: number; awaiting_info: number; escalated: number }[];
  costSeries: { date: string; ai: number; telephony: number; email: number }[];
  responseBuckets: { bucket: string; count: number }[];
}

export function computeDashboard(allEnquiries: MEnquiry[], calls: MCall[], usage: MUsage[], handoffs: MHandoff[], s: Settings, f: Filters): DashboardMetrics {
  const rows = applyFilters(allEnquiries, f);
  const count = (st: string) => rows.filter((r) => r.status === st).length;
  const ids = new Set(rows.map((r) => r.id));
  const myCalls = calls.filter((c) => ids.has(c.enquiry_id));
  const responded = rows.filter((r) => r.first_response_seconds !== null);
  const avg = responded.length ? responded.reduce((a, r) => a + (r.first_response_seconds ?? 0), 0) / responded.length : null;
  const within = responded.length ? (responded.filter((r) => (r.first_response_seconds ?? Infinity) <= 300).length / responded.length) * 100 : null;
  const costs = computeCosts(rows, calls, usage, handoffs, s, f);
  const qualified = count("qualified");
  const withConsultOutcome = rows.filter((r) => r.consultation_status !== "unknown");
  const withProjectOutcome = rows.filter((r) => r.project_outcome !== "unknown");

  // Daily series
  const byDay = new Map<string, DashboardMetrics["series"][number]>();
  for (const r of rows) {
    const d = istDate(r.created_at);
    const e = byDay.get(d) ?? { date: d, total: 0, qualified: 0, not_qualified: 0, awaiting_info: 0, escalated: 0 };
    e.total += 1;
    if (r.status in e) (e as unknown as Record<string, number>)[r.status] += 1;
    byDay.set(d, e);
  }
  const costByDay = new Map<string, { date: string; ai: number; telephony: number; email: number }>();
  const bump = (d: string, k: "ai" | "telephony" | "email", v: number) => {
    const e = costByDay.get(d) ?? { date: d, ai: 0, telephony: 0, email: 0 };
    e[k] += v;
    costByDay.set(d, e);
  };
  for (const u of usage) if (u.enquiry_id && ids.has(u.enquiry_id)) bump(istDate(u.at), "ai", aiCostUsd(u, s) * s.usdToInr);
  for (const c of myCalls) bump(istDate(c.ring_at), "telephony", billedMinutes(c.duration_seconds) * s.telephonyInrPerMinute);
  for (const h of handoffs) if (ids.has(h.enquiry_id) && h.status === "sent") bump(istDate(h.created_at), "email", s.emailInrPerMessage);

  const buckets = [
    { bucket: "< 10 s", test: (x: number) => x < 10 },
    { bucket: "10–60 s", test: (x: number) => x >= 10 && x < 60 },
    { bucket: "1–5 min", test: (x: number) => x >= 60 && x <= 300 },
    { bucket: "> 5 min", test: (x: number) => x > 300 },
  ].map((b) => ({ bucket: b.bucket, count: responded.filter((r) => b.test(r.first_response_seconds ?? 0)).length }));

  return {
    total: rows.length,
    qualified,
    notQualified: count("not_qualified"),
    awaiting: count("awaiting_info"),
    escalated: count("escalated"),
    inProgress: count("in_progress"),
    calls: myCalls.length,
    repeatCallsMerged: Math.max(0, myCalls.length - rows.length),
    afterHours: rows.filter((r) => r.after_hours).length,
    urgent: rows.filter((r) => r.urgent).length,
    avgResponseSeconds: avg,
    pctWithin5Min: within,
    answeredCount: responded.length,
    consultationsRequested: rows.filter((r) => r.consultation_requested === 1).length,
    consultationsCompleted: withConsultOutcome.length ? withConsultOutcome.filter((r) => r.consultation_status === "completed").length : null,
    projectsWon: withProjectOutcome.length ? withProjectOutcome.filter((r) => r.project_outcome === "won").length : null,
    outcomesRecorded: withProjectOutcome.length,
    demoCount: rows.filter((r) => r.is_demo).length,
    liveCount: rows.filter((r) => !r.is_demo).length,
    costs,
    costPerEnquiry: rows.length ? costs.totalInr / rows.length : null,
    costPerQualified: qualified ? costs.totalInr / qualified : null,
    projectedMonthlyInr: rows.length ? (costs.variableInr / rows.length) * s.expectedMonthlyEnquiries + costs.recurringMonthlyInr : null,
    series: Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date)),
    costSeries: Array.from(costByDay.values()).sort((a, b) => a.date.localeCompare(b.date)),
    responseBuckets: buckets,
  };
}
