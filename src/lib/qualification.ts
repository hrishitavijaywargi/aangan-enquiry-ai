/**
 * Deterministic qualification engine — implements the five criteria in qualified.md exactly.
 * The AI layer may help *extract* fields, but the decision is made only here.
 */
import { COMMERCIAL_MAX_SQFT, COMMERCIAL_MAX_TOLERANCE, COMMERCIAL_MIN_SQFT, OUT_OF_SCOPE_PROJECT_TYPES, TIMELINE_RULES } from "./config/business";
import { BUDGET_THRESHOLDS, INTERNAL_PRICING } from "./config/pricingInternal";
import { weeksBetween } from "./timeline";
import type { CriterionResult, EnquiryFields, QualificationResult } from "./types";

type Ev = Partial<Record<string, string>>;
const q = (ev: Ev, ...keys: string[]) => keys.map((k) => ev[k]).filter((x): x is string => !!x).map((x) => `“${x}”`);

export const CRITERIA_NAMES: Record<number, string> = {
  1: "Real project (design + execution)",
  2: "In service area (Pune / PCMC)",
  3: "Realistic timeline",
  4: "Budget alignment (only if volunteered)",
  5: "Decision-maker on the call (or represented)",
};

export function evalRealProject(f: EnquiryFields, ev: Ev): CriterionResult {
  const base = { id: 1 as const, name: CRITERIA_NAMES[1] };
  if (f.outOfScopeType) {
    return { ...base, status: "fail", reason: OUT_OF_SCOPE_PROJECT_TYPES[f.outOfScopeType] ?? "Project type is outside our scope (services.md).", evidence: q(ev, "outOfScopeType") };
  }
  const nonExec: Record<string, string> = {
    advice_only: "Caller wants ideas/advice rather than design + execution. Minimum engagement is a room redesign with execution (qualified.md, services.md).",
    design_only: "Caller intends to do execution themselves. Aangan only takes design + execution (qualified.md).",
    styling_only: "Decor/styling only — services.md lists this under ‘What we don’t do’.",
    furniture_only: "Standalone furniture sourcing is not offered (services.md).",
    vastu_only: "Standalone Vastu consultation is not offered (services.md).",
    structural: "Architecture/structural work is not offered (services.md).",
  };
  if (f.scopeType && f.scopeType !== "design_and_execution") {
    return { ...base, status: "fail", reason: nonExec[f.scopeType], evidence: q(ev, "scopeType") };
  }
  if (f.projectCategory === "commercial" && f.carpetAreaSqft) {
    if (f.carpetAreaSqft < COMMERCIAL_MIN_SQFT) {
      return { ...base, status: "fail", reason: `Commercial space of ${f.carpetAreaSqft} sq ft is below the minimum scope we can deliver well (front-desk practice in T18: ~${COMMERCIAL_MIN_SQFT} sq ft — confirm with Nikhil).`, evidence: q(ev, "carpetAreaSqft") };
    }
    if (f.carpetAreaSqft > COMMERCIAL_MAX_SQFT * (1 + COMMERCIAL_MAX_TOLERANCE)) {
      return { ...base, status: "fail", reason: `Commercial projects are taken up to ~${COMMERCIAL_MAX_SQFT.toLocaleString("en-IN")} sq ft (services.md); this is ${f.carpetAreaSqft.toLocaleString("en-IN")} sq ft.`, evidence: q(ev, "carpetAreaSqft") };
    }
  }
  if (f.scopeType === "design_and_execution") {
    const extra = f.structuralRequest ? " Note: caller mentioned structural changes — Aangan does not do structural work; designer to clarify." : "";
    return { ...base, status: "pass", reason: "Caller wants design with execution." + extra, evidence: q(ev, "scopeType", "rooms") };
  }
  return {
    ...base,
    status: "unclear",
    reason: f.earlyStage ? "Caller says they are at an early/exploring stage — not yet clear they want design + execution." : "Not yet clear whether the caller wants full design + execution or advice only.",
    evidence: q(ev, "scopeSignal", "earlyStage", "rooms"),
  };
}

export function evalServiceArea(f: EnquiryFields, ev: Ev): CriterionResult {
  const base = { id: 2 as const, name: CRITERIA_NAMES[2] };
  if (f.locationStatus === "out_of_area") {
    return { ...base, status: "fail", reason: `${f.location} is outside Pune city / PCMC. We don't have the vendor network there (qualified.md).`, evidence: q(ev, "location", "locationStatus") };
  }
  if (f.locationStatus === "in_area") {
    return { ...base, status: "pass", reason: f.location === "Pune" ? "Caller said Pune (locality not yet specified)." : `${f.location} is within our service area (services.md).`, evidence: q(ev, "location", "locationStatus") };
  }
  return { ...base, status: "unclear", reason: f.location ? `Not sure whether “${f.location}” is within Pune city or PCMC.` : "Project location not yet known.", evidence: q(ev, "location") };
}

export function evalTimeline(f: EnquiryFields, ev: Ev, now: Date): CriterionResult {
  const base = { id: 3 as const, name: CRITERIA_NAMES[3] };
  const r = TIMELINE_RULES;
  const minTotal = r.designWeeksMin + r.executionWeeksMin;
  if (f.requiredByDate) {
    const weeks = weeksBetween(now, new Date(f.requiredByDate + "T00:00:00Z"));
    const w = Math.max(0, Math.round(weeks * 10) / 10);
    if (weeks < r.minLeadWeeks) {
      return { ...base, status: "fail", reason: `Needs completion in ~${w} weeks. We cannot take on a project that must be ready in under ${r.minLeadWeeks} weeks (services.md).`, evidence: q(ev, "requiredByDate") };
    }
    if (weeks < minTotal) {
      return { ...base, status: "fail", reason: `Needs completion in ~${w} weeks, but design (${r.designWeeksMin}–${r.designWeeksMax} wks) plus execution (min ${r.executionWeeksMin} wks) needs at least ${minTotal} weeks (services.md).`, evidence: q(ev, "requiredByDate") };
    }
  }
  if (f.siteAvailableInWeeks !== undefined && f.siteAvailableInWeeks > r.maxSiteAvailabilityWeeks) {
    return { ...base, status: "fail", reason: `Site will only be available in ~${f.siteAvailableInWeeks} weeks; it must be available for execution within ${r.maxSiteAvailabilityWeeks} weeks of the consultation (qualified.md). Re-engage closer to possession.`, evidence: q(ev, "siteAvailableInWeeks") };
  }
  if (f.requiredByDate) {
    const weeks = Math.round(weeksBetween(now, new Date(f.requiredByDate + "T00:00:00Z")));
    return { ...base, status: "pass", reason: `Completion needed in ~${weeks} weeks — fits design + execution timelines.`, evidence: q(ev, "requiredByDate", "siteAvailableInWeeks") };
  }
  if (f.timelineFlexible) {
    return { ...base, status: "pass", reason: "No fixed deadline — timeline is flexible.", evidence: q(ev, "timelineFlexible", "siteAvailableInWeeks") };
  }
  if (f.siteAvailableInWeeks !== undefined && f.startText) {
    return { ...base, status: "pass", reason: `Site available in ~${f.siteAvailableInWeeks} weeks and caller wants to start (${f.startText}); no completion deadline that conflicts.`, evidence: q(ev, "siteAvailableInWeeks") };
  }
  return { ...base, status: "unclear", reason: "Completion timeline not yet known.", evidence: q(ev, "siteAvailableInWeeks") };
}

/** Lowest plausible cost for the described scope — INTERNAL, used only to spot clear misalignment. */
export function minimumIndicativeCost(f: EnquiryFields): number | undefined {
  const rooms = (f.rooms ?? []).filter((r) => !["flooring", "wardrobes"].includes(r));
  if (f.projectCategory === "commercial" && f.carpetAreaSqft) return f.carpetAreaSqft * INTERNAL_PRICING.commercialMinPerSqft;
  const fullHome = rooms.includes("full home");
  if (f.projectCategory === "residential" || rooms.length) {
    if (fullHome && f.carpetAreaSqft) return f.carpetAreaSqft * INTERNAL_PRICING.residentialMinPerSqft;
    const roomCount = rooms.filter((r) => r !== "full home").length;
    if (roomCount > 0) return roomCount * INTERNAL_PRICING.singleRoomMinInr;
    if (fullHome) return 2 * INTERNAL_PRICING.singleRoomMinInr;
  }
  return undefined;
}

export function evalBudget(f: EnquiryFields, ev: Ev): CriterionResult {
  const base = { id: 4 as const, name: CRITERIA_NAMES[4] };
  if (!f.budgetMaxInr) {
    return {
      ...base,
      status: "pass",
      reason: f.budgetMentionedNoFigure ? "Budget mentioned without a figure — not probed (qualified.md)." : "Budget not mentioned — treated as qualified; not probed (qualified.md).",
      evidence: q(ev, "budgetMentionedNoFigure"),
    };
  }
  const min = minimumIndicativeCost(f);
  if (!min) {
    return { ...base, status: "assumed_pass", reason: "Budget volunteered but scope not detailed enough to judge — designer to discuss.", evidence: q(ev, "budgetMaxInr") };
  }
  const ratio = f.budgetMaxInr / min;
  if (ratio < BUDGET_THRESHOLDS.clearlyBelowRatio) {
    return { ...base, status: "fail", reason: "Volunteered budget is clearly below what the described scope would cost (internal guide). Addressed honestly on the call without quoting any figure.", evidence: q(ev, "budgetMaxInr", "rooms") };
  }
  if (ratio < BUDGET_THRESHOLDS.flagBelowRatio) {
    return { ...base, status: "assumed_pass", reason: "Volunteered budget may be tight for the described scope — not a clear mismatch; designer to discuss at consultation.", evidence: q(ev, "budgetMaxInr") };
  }
  return { ...base, status: "pass", reason: "Volunteered budget is broadly aligned with the described scope.", evidence: q(ev, "budgetMaxInr") };
}

export function evalDecisionMaker(f: EnquiryFields, ev: Ev): CriterionResult {
  const base = { id: 5 as const, name: CRITERIA_NAMES[5] };
  switch (f.decisionMaker) {
    case "self":
      return { ...base, status: "pass", reason: "Caller is the owner / decision-maker.", evidence: q(ev, "decisionMaker") };
    case "joint_owner_confirmed":
      return { ...base, status: "pass", reason: "Caller is a joint owner and confirms the co-owner is on board.", evidence: q(ev, "decisionMaker") };
    case "authorised_representative":
      return { ...base, status: "pass", reason: "Caller confirms they are authorised to move forward on the decision-maker's behalf.", evidence: q(ev, "decisionMaker") };
    case "representing_attending":
      return { ...base, status: "assumed_pass", reason: "Caller is representing the decision-makers, who will attend the consultation. Treated as qualified; flagged for the designer.", evidence: q(ev, "decisionMaker") };
    case "not_authorised":
      return { ...base, status: "fail", reason: "Caller is doing research for someone else and is not authorised to proceed (qualified.md: ‘not sufficient on its own’).", evidence: q(ev, "decisionMaker") };
    default:
      return { ...base, status: "assumed_pass", reason: "Decision-maker status not confirmed. Per qualified.md we don't push — treated as qualified and flagged.", evidence: [] };
  }
}

export function qualify(f: EnquiryFields, ev: Ev, now: Date): QualificationResult {
  if (f.complaint) {
    return {
      decision: "not_applicable",
      criteria: [],
      failed: [],
      unclear: [],
      uncertainties: [],
      summary: "Existing-client complaint — not a sales lead. Escalated to a human; qualification does not apply.",
    };
  }
  const criteria = [evalRealProject(f, ev), evalServiceArea(f, ev), evalTimeline(f, ev, now), evalBudget(f, ev), evalDecisionMaker(f, ev)];
  const failed = criteria.filter((c) => c.status === "fail").map((c) => c.id);
  const unclear = criteria.filter((c) => c.status === "unclear").map((c) => c.id);
  const uncertainties = criteria.filter((c) => c.status === "assumed_pass").map((c) => `Criterion ${c.id} (${c.name}): ${c.reason}`);

  let decision: QualificationResult["decision"];
  let summary: string;
  if (failed.length >= 2) {
    decision = "declined";
    summary = `Declined — ${failed.length} criteria failed (${failed.map((i) => CRITERIA_NAMES[i]).join("; ")}).`;
  } else if (failed.length === 1) {
    decision = "not_qualified";
    summary = `Not qualified — failed: ${CRITERIA_NAMES[failed[0]]}. ${criteria.find((c) => c.id === failed[0])!.reason}`;
  } else if (unclear.length) {
    decision = "needs_clarification";
    summary = `Needs clarification on: ${unclear.map((i) => CRITERIA_NAMES[i]).join("; ")}.`;
  } else {
    decision = "qualified";
    summary = uncertainties.length ? `Qualified — all five criteria met (with ${uncertainties.length} flagged ${uncertainties.length > 1 ? "uncertainties" : "uncertainty"}).` : "Qualified — all five criteria met.";
  }
  return { decision, criteria, failed, unclear, uncertainties, summary };
}
