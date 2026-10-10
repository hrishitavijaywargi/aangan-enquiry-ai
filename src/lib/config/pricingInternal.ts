/**
 * INTERNAL ONLY — pricing.md. Never sent to callers, never rendered in caller-facing text.
 * Used for exactly one purpose: detecting a *volunteered* budget that is clearly below
 * what the described scope could cost (qualified.md criterion 4). The agent addresses
 * such a mismatch without stating any number.
 */
export const INTERNAL_PRICING = {
  residentialMinPerSqft: 1800, // lowest residential band (Standard spec, lower bound)
  commercialMinPerSqft: 1200, // lowest commercial band (Basic fitout, lower bound)
  singleRoomMinInr: 350000, // single room redesign lower bound (₹3.5 lakh)
};

/**
 * Thresholds for "clearly below". ASSUMPTION (not in source files):
 *  - volunteered max budget < 50% of the lowest indicative cost  → criterion 4 FAILS
 *  - 50%–80%                                                     → passes, flagged for designer
 */
export const BUDGET_THRESHOLDS = { clearlyBelowRatio: 0.5, flagBelowRatio: 0.8 };
