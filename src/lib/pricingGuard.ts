/**
 * Pricing guardrails (pricing.md → "What the agent must never say").
 * Every caller-facing sentence passes through `guardCallerReply` before it is spoken/saved —
 * including text produced by an LLM. If anything looks like a price, the whole reply is
 * replaced with the approved script.
 */
import { PRICING_SCRIPT } from "./config/business";

export { PRICING_SCRIPT };

const MONEY_PATTERNS: RegExp[] = [
  /₹/,
  /\b(rs\.?|inr|rupees?)\s*\d/i,
  /\d[\d,.]*\s*(lakh|lakhs|lac|lacs|crore|cr|k)\b/i,
  /\b(lakh|lakhs|lac|crore)\b/i,
  /\bper\s*(sq\.?|square)\s*(ft|feet|foot|metre|meter)\b/i,
  /\/\s*sq\.?\s*ft/i,
  /\b(it'?ll|it will|would|should|usually|typically|generally)\s+(cost|come to|be around|run you)\b/i,
  /\b(cost|costs|price|prices|pricing|rate|rates|charges?|fees?)\b[^.?!]{0,40}\b(around|about|approximately|roughly|from|between|start(s|ing)?( at)?|upwards of|under|below|at least)\b[^.?!]{0,20}\d/i,
  /\b(our )?rates start\b/i,
  /\bfor a \dbhk (it'?s|it is) typically\b/i,
  /\b(starting|starts) (at|from)\s*\d/i,
  /\b\d[\d,]*\s*(-|–|to)\s*\d[\d,]*\s*(per|\/)/i,
];

/** True if `text` discloses (or appears to disclose) a price, range, rate or estimate. */
export function containsPriceDisclosure(text: string): boolean {
  if (text.includes(PRICING_SCRIPT)) {
    return containsPriceDisclosure(text.replace(PRICING_SCRIPT, ""));
  }
  return MONEY_PATTERNS.some((re) => re.test(text));
}

export interface GuardResult {
  text: string;
  blocked: boolean;
  reason?: string;
}

/** Final gate for caller-facing text. Replaces any price-like reply with the approved script. */
export function guardCallerReply(text: string): GuardResult {
  if (containsPriceDisclosure(text)) {
    return { text: PRICING_SCRIPT, blocked: true, reason: "Reply contained price-like content and was replaced with the approved pricing script." };
  }
  return { text, blocked: false };
}
