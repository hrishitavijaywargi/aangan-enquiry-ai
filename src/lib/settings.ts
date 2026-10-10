/**
 * Configurable cost & operating assumptions. Defaults are ASSUMPTIONS for demo purposes and
 * are labelled as such in the UI; the founder edits them on the Settings page.
 */
import { DEFAULT_OFFICE_HOURS } from "./config/business";
import { getDb } from "./db";
import type { Settings } from "./types";

export const DEFAULT_SETTINGS: Settings = {
  officeStartHour: DEFAULT_OFFICE_HOURS.startHour,
  officeEndHour: DEFAULT_OFFICE_HOURS.endHour,
  workingDays: DEFAULT_OFFICE_HOURS.workingDays,
  dedupeWindowDays: 30,
  expectedMonthlyEnquiries: 200, // problem statement: ~200 enquiries/month
  usdToInr: 88, // ASSUMPTION — update to the current rate
  // Anthropic list price for claude-opus-5-5 at time of build ($4 / $20 per million tokens). Verify on anthropic.com/pricing.
  aiInputUsdPerMTok: 4,
  aiOutputUsdPerMTok: 20,
  telephonyInrPerMinute: 1.5, // ASSUMPTION — set from your telephony provider's India inbound rate
  emailInrPerMessage: 0, // ASSUMPTION — most SMTP providers' free tiers cover this volume
  recurring: [
    { label: "Virtual phone number rental (assumed)", inrPerMonth: 500 },
    { label: "App hosting (assumed)", inrPerMonth: 1500 },
  ],
  festivalDates: { diwali: "2026-11-08" },
  autoSendHandoffs: true,
};

export function getSettings(): Settings {
  const rows = getDb().prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const stored: Record<string, unknown> = {};
  for (const r of rows) {
    try {
      stored[r.key] = JSON.parse(r.value);
    } catch {
      /* ignore corrupt row */
    }
  }
  return { ...DEFAULT_SETTINGS, ...stored } as Settings;
}

const NUMERIC_KEYS: (keyof Settings)[] = [
  "officeStartHour", "officeEndHour", "dedupeWindowDays", "expectedMonthlyEnquiries", "usdToInr",
  "aiInputUsdPerMTok", "aiOutputUsdPerMTok", "telephonyInrPerMinute", "emailInrPerMessage",
];

/** Validate and persist a partial settings update. Throws with a readable message on bad input. */
export function updateSettings(patch: Partial<Settings>): Settings {
  const db = getDb();
  const stmt = db.prepare("INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  for (const [k, v] of Object.entries(patch) as [keyof Settings, unknown][]) {
    if (!(k in DEFAULT_SETTINGS)) throw new Error(`Unknown setting: ${k}`);
    if (NUMERIC_KEYS.includes(k)) {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) throw new Error(`${k} must be a non-negative number`);
      stmt.run(k, JSON.stringify(n));
      continue;
    }
    if (k === "recurring") {
      if (!Array.isArray(v)) throw new Error("recurring must be a list");
      const clean = v.map((r) => {
        const item = r as { label?: unknown; inrPerMonth?: unknown };
        const amt = Number(item.inrPerMonth);
        if (!String(item.label ?? "").trim() || !Number.isFinite(amt) || amt < 0) throw new Error("Each recurring cost needs a label and a non-negative amount");
        return { label: String(item.label).trim(), inrPerMonth: amt };
      });
      stmt.run(k, JSON.stringify(clean));
      continue;
    }
    stmt.run(k, JSON.stringify(v));
  }
  return getSettings();
}

export function resetSettings() {
  getDb().exec("DELETE FROM settings");
}
