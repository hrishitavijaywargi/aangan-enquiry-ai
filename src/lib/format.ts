/** Client-safe formatting helpers (no server imports). */

export const STATUS_META: Record<string, { label: string; icon: string; cls: string; color: string }> = {
  qualified: { label: "Qualified", icon: "✓", cls: "bg-green-50 text-green-800 ring-green-600/30", color: "#0ca30c" },
  not_qualified: { label: "Not Qualified", icon: "–", cls: "bg-stone-100 text-stone-700 ring-stone-500/30", color: "#898781" },
  awaiting_info: { label: "Awaiting Information", icon: "…", cls: "bg-amber-50 text-amber-800 ring-amber-500/40", color: "#fab219" },
  escalated: { label: "Escalated", icon: "!", cls: "bg-red-50 text-red-800 ring-red-600/30", color: "#d03b3b" },
  in_progress: { label: "In Progress", icon: "●", cls: "bg-sky-50 text-sky-800 ring-sky-600/30", color: "#2a78d6" },
};

export const TYPE_LABEL: Record<string, string> = { residential: "Residential", commercial: "Commercial", complaint: "Existing-client complaint", unknown: "Unknown" };

/** Categorical slots 1–3 of the validated reference palette (dataviz skill). */
export const SERIES = { ai: "#2a78d6", telephony: "#eb6834", email: "#1baf7a" };

export const inr = (n: number | null | undefined, digits = 0) =>
  n === null || n === undefined || !Number.isFinite(n) ? "—" : "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const secs = (s: number | null | undefined) => {
  if (s === null || s === undefined) return "—";
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${Math.round(s % 60)} s`;
};

export const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${Math.round(n)}%`);

/** "Sheetal Deshpande" → "Sheetal D." — lists show minimal personal data. */
export function displayName(name: string | null | undefined): string {
  if (!name) return "Unknown caller";
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
}

export function istDateTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 330 * 60_000);
  const date = d.toISOString().slice(0, 10);
  const h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  const ap = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${date} ${h12}:${m} ${ap}`;
}

export const HANDOFF_STATUS: Record<string, string> = {
  preview: "Preview only — not sent",
  saved_locally: "Saved locally (.eml) — NOT sent",
  sent: "Sent",
  failed: "Send failed — saved locally",
};
