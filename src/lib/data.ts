/** Read-side queries shared by pages and API routes. */
import { getDb } from "./db";
import { computeDashboard, type Filters, type MCall, type MEnquiry, type MHandoff, type MUsage } from "./metrics";
import type { EnquiryRow, HandoffRow } from "./service";
import { getSettings } from "./settings";

export async function loadAll() {
  const db = await getDb();
  const [enquiries, calls, usage, handoffs] = await Promise.all([
    db.all<MEnquiry & EnquiryRow>("SELECT * FROM enquiries ORDER BY created_at DESC"),
    db.all<MCall>("SELECT * FROM calls ORDER BY ring_at DESC"),
    db.all<MUsage>("SELECT * FROM ai_usage"),
    db.all<MHandoff>("SELECT enquiry_id, status, created_at FROM handoffs"),
  ]);
  return { enquiries, calls, usage, handoffs };
}

export async function dashboard(f: Filters) {
  const [d, s] = await Promise.all([loadAll(), getSettings()]);
  return computeDashboard(d.enquiries, d.calls, d.usage, d.handoffs, s, f);
}

export async function listHandoffs() {
  return (await getDb()).all<HandoffRow & { ref: string; caller_name: string | null; enquiry_status: string; is_demo: number }>(
    "SELECT h.*, e.ref, e.caller_name, e.status AS enquiry_status, e.is_demo FROM handoffs h JOIN enquiries e ON e.id = h.enquiry_id ORDER BY h.created_at DESC",
  );
}

export async function callCostRows() {
  return (await getDb()).all<{
    id: string; ring_at: string; duration_seconds: number | null; response_seconds: number | null; status: string; provider: string; is_demo: number;
    ref: string; enquiry_id: string; caller_name: string | null; enquiry_status: string; input_tokens: number; output_tokens: number; all_estimates: number; ai_requests: number; model: string | null;
  }>(
    `SELECT c.id, c.ring_at, c.duration_seconds, c.response_seconds, c.status, c.provider, c.is_demo, e.ref, e.id AS enquiry_id, e.caller_name, e.status AS enquiry_status,
            CAST(COALESCE(SUM(u.input_tokens), 0) AS INTEGER) AS input_tokens, CAST(COALESCE(SUM(u.output_tokens), 0) AS INTEGER) AS output_tokens,
            CAST(COALESCE(MIN(u.is_estimate), 1) AS INTEGER) AS all_estimates, CAST(COUNT(u.id) AS INTEGER) AS ai_requests, MAX(u.model) AS model
     FROM calls c JOIN enquiries e ON e.id = c.enquiry_id LEFT JOIN ai_usage u ON u.call_id = c.id
     GROUP BY c.id, e.id ORDER BY c.ring_at DESC`,
  );
}
