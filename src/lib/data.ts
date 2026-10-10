/** Read-side queries shared by pages and API routes. */
import { getDb } from "./db";
import { computeDashboard, type Filters, type MCall, type MEnquiry, type MHandoff, type MUsage } from "./metrics";
import type { EnquiryRow, HandoffRow } from "./service";
import { getSettings } from "./settings";

export function loadAll() {
  const db = getDb();
  return {
    enquiries: db.prepare("SELECT * FROM enquiries ORDER BY created_at DESC").all() as unknown as (MEnquiry & EnquiryRow)[],
    calls: db.prepare("SELECT * FROM calls ORDER BY ring_at DESC").all() as unknown as MCall[],
    usage: db.prepare("SELECT * FROM ai_usage").all() as unknown as MUsage[],
    handoffs: db.prepare("SELECT enquiry_id, status, created_at FROM handoffs").all() as unknown as MHandoff[],
  };
}

export function dashboard(f: Filters) {
  const d = loadAll();
  const s = getSettings();
  return computeDashboard(d.enquiries, d.calls, d.usage, d.handoffs, s, f);
}

export function listHandoffs() {
  return getDb()
    .prepare("SELECT h.*, e.ref, e.caller_name, e.status AS enquiry_status, e.is_demo FROM handoffs h JOIN enquiries e ON e.id = h.enquiry_id ORDER BY h.created_at DESC")
    .all() as unknown as (HandoffRow & { ref: string; caller_name: string | null; enquiry_status: string; is_demo: number })[];
}

export function callCostRows() {
  const db = getDb();
  return db
    .prepare(
      `SELECT c.id, c.ring_at, c.duration_seconds, c.response_seconds, c.status, c.provider, c.is_demo, e.ref, e.id AS enquiry_id, e.caller_name, e.status AS enquiry_status,
              COALESCE(SUM(u.input_tokens), 0) AS input_tokens, COALESCE(SUM(u.output_tokens), 0) AS output_tokens,
              COALESCE(MIN(u.is_estimate), 1) AS all_estimates, COUNT(u.id) AS ai_requests, MAX(u.model) AS model
       FROM calls c JOIN enquiries e ON e.id = c.enquiry_id LEFT JOIN ai_usage u ON u.call_id = c.id
       GROUP BY c.id ORDER BY c.ring_at DESC`,
    )
    .all() as unknown as {
    id: string; ring_at: string; duration_seconds: number | null; response_seconds: number | null; status: string; provider: string; is_demo: number;
    ref: string; enquiry_id: string; caller_name: string | null; enquiry_status: string; input_tokens: number; output_tokens: number; all_estimates: number; ai_requests: number; model: string | null;
  }[];
}
