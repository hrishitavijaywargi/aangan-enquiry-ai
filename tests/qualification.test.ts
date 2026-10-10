import { describe, expect, it } from "vitest";
import { qualify } from "@/lib/qualification";
import type { EnquiryFields } from "@/lib/types";
import { runScenario } from "./helpers";

const NOW = new Date("2026-09-15T05:00:00Z");
const base: EnquiryFields = {
  projectCategory: "residential",
  propertyType: "3BHK apartment",
  location: "Kothrud",
  locationStatus: "in_area",
  carpetAreaSqft: 1200,
  rooms: ["kitchen", "living room", "bedrooms"],
  scopeType: "design_and_execution",
  timelineFlexible: true,
  decisionMaker: "self",
};
const status = (f: EnquiryFields, id: number) => qualify(f, {}, NOW).criteria.find((c) => c.id === id)!.status;

describe("qualification decisions on the September transcripts", () => {
  const expected: Record<string, string> = {
    "t01-kothrud-3bhk": "qualified",
    "t02-wakad-price": "qualified",
    "t03-nashik": "not_qualified",
    "t04-advice-only": "not_qualified",
    "t05-koregaon-4bhk": "qualified",
    "t06-baner-office": "qualified",
    "t07-diwali-deadline": "not_qualified",
    "t08-after-hours": "qualified",
    "t09-complaint": "escalated",
    "t10-kharadi-budget": "not_qualified",
    "t11-baner-rented": "qualified",
    "t12-kalyani-villa": "qualified",
    "t13-aundh-price": "qualified",
    "t14-parents-hadapsar": "qualified",
    "t15-undri-possession": "qualified",
    "t17-ritu-dropped": "awaiting_info",
    "s-early-stage": "awaiting_info",
    "t18-coworking-pod": "not_qualified",
    "t19-restaurant": "not_qualified",
    "t20-magarpatta": "qualified",
    "s-not-authorised": "not_qualified",
  };
  for (const [key, want] of Object.entries(expected)) {
    it(`${key} → ${want}`, () => expect(runScenario(key).outcome.status).toBe(want));
  }

  it("names the failed criterion for each unsuitable enquiry", () => {
    expect(runScenario("t03-nashik").outcome.qualification.failed).toEqual([2]);
    expect(runScenario("t04-advice-only").outcome.qualification.failed).toEqual([1]);
    expect(runScenario("t07-diwali-deadline").outcome.qualification.failed).toEqual([3]);
    expect(runScenario("t10-kharadi-budget").outcome.qualification.failed).toEqual([4]);
    expect(runScenario("t18-coworking-pod").outcome.qualification.failed).toEqual([1]);
    expect(runScenario("t19-restaurant").outcome.qualification.failed).toEqual([1]);
    expect(runScenario("s-not-authorised").outcome.qualification.failed).toEqual([5]);
  });
});

describe("the five criteria (qualified.md)", () => {
  it("all five passing → qualified", () => expect(qualify(base, {}, NOW).decision).toBe("qualified"));

  it("unknown budget is treated as qualified (criterion 4)", () => {
    const q = qualify({ ...base, budgetMaxInr: undefined }, {}, NOW);
    expect(q.criteria[3].status).toBe("pass");
    expect(q.decision).toBe("qualified");
  });

  it("a budget mentioned without a figure is not probed and passes", () => {
    expect(status({ ...base, budgetMentionedNoFigure: true }, 4)).toBe("pass");
  });

  it("a clearly unrealistic volunteered budget fails criterion 4", () => {
    expect(status({ ...base, rooms: ["kitchen", "bedroom"], carpetAreaSqft: 550, budgetMaxInr: 150_000 }, 4)).toBe("fail");
  });

  it("a merely tight volunteered budget is flagged, not failed", () => {
    // 1,300 sq ft full home with ₹22 lakh (F10-like) — not a *clear* mismatch
    expect(status({ ...base, rooms: ["full home"], carpetAreaSqft: 1300, budgetMaxInr: 2_200_000 }, 4)).not.toBe("fail");
  });

  it("authorised representatives pass criterion 5", () => {
    expect(status({ ...base, decisionMaker: "authorised_representative" }, 5)).toBe("pass");
    expect(status({ ...base, decisionMaker: "joint_owner_confirmed" }, 5)).toBe("pass");
  });

  it("representing decision-makers who will attend → qualified but flagged", () => {
    const q = qualify({ ...base, decisionMaker: "representing_attending" }, {}, NOW);
    expect(q.criteria[4].status).toBe("assumed_pass");
    expect(q.decision).toBe("qualified");
    expect(q.uncertainties.length).toBe(1);
  });

  it("unclear decision-maker is not pushed: treated as qualified and flagged", () => {
    const q = qualify({ ...base, decisionMaker: undefined }, {}, NOW);
    expect(q.decision).toBe("qualified");
    expect(q.uncertainties[0]).toMatch(/Criterion 5/);
  });

  it("'just research for my in-laws' fails criterion 5", () => {
    expect(status({ ...base, decisionMaker: "not_authorised" }, 5)).toBe("fail");
  });

  it("unclear criterion 1, 2 or 3 → needs clarification (not a decline)", () => {
    expect(qualify({ ...base, locationStatus: "unclear" }, {}, NOW).decision).toBe("needs_clarification");
    expect(qualify({ ...base, scopeType: undefined }, {}, NOW).decision).toBe("needs_clarification");
    expect(qualify({ ...base, timelineFlexible: undefined }, {}, NOW).decision).toBe("needs_clarification");
  });

  it("one failed criterion → not qualified; two or more → declined", () => {
    expect(qualify({ ...base, locationStatus: "out_of_area", location: "Nashik" }, {}, NOW).decision).toBe("not_qualified");
    expect(qualify({ ...base, locationStatus: "out_of_area", location: "Nashik", scopeType: "advice_only" }, {}, NOW).decision).toBe("declined");
  });

  it("timeline: < 6 weeks fails, design+execution must fit, March is fine", () => {
    expect(status({ ...base, timelineFlexible: undefined, requiredByDate: "2026-10-06" }, 3)).toBe("fail"); // 3 weeks
    expect(status({ ...base, timelineFlexible: undefined, requiredByDate: "2026-11-15" }, 3)).toBe("fail"); // ~9 weeks
    expect(status({ ...base, timelineFlexible: undefined, requiredByDate: "2027-03-31" }, 3)).toBe("pass");
  });

  it("site unavailable for more than 10 weeks fails criterion 3", () => {
    expect(status({ ...base, siteAvailableInWeeks: 20 }, 3)).toBe("fail");
  });

  it("does NOT disqualify: rented home, single room, uncertain materials, pricing question", () => {
    expect(qualify({ ...base, rented: true }, {}, NOW).decision).toBe("qualified");
    expect(qualify({ ...base, rooms: ["living room"] }, {}, NOW).decision).toBe("qualified");
    expect(qualify({ ...base, pricingQuestionCount: 3 }, {}, NOW).decision).toBe("qualified");
  });

  it("does NOT disqualify after-hours callers", () => {
    const r = runScenario("t08-after-hours");
    expect(r.events).toContain("after_hours");
    expect(r.outcome.status).toBe("qualified");
  });

  it("out-of-scope project types fail criterion 1 (services.md)", () => {
    expect(status({ ...base, outOfScopeType: "gym", projectCategory: "commercial" }, 1)).toBe("fail");
    expect(status({ ...base, projectCategory: "commercial", carpetAreaSqft: 5000 }, 1)).toBe("fail");
  });

  it("every criterion result carries a reason; evidence quotes come from the caller", () => {
    const r = runScenario("t01-kothrud-3bhk");
    for (const c of r.outcome.qualification.criteria) expect(c.reason.length).toBeGreaterThan(10);
    expect(r.outcome.qualification.criteria[1].evidence.join(" ")).toMatch(/Kothrud/);
  });

  it("the AI cannot override the decision: AI-supplied fields only fill gaps", async () => {
    const { processCallerTurn, greet, newSession } = await import("@/lib/agent");
    const ctx = { now: NOW, settings: { festivalDates: {}, officeStartHour: 10, officeEndHour: 19, workingDays: [1, 2, 3, 4, 5, 6] } };
    let r = greet(newSession(), ctx);
    // AI claims the location is Kothrud and in-area, but the caller said Nashik.
    r = processCallerTurn(r.session, "I'm Suresh, I want to redo my home office in Nashik, full design and execution.", ctx, { location: "Kothrud", locationStatus: "in_area" });
    expect(r.session.fields.location).toBe("Nashik");
    expect(r.qualification.failed).toContain(2);
  });
});
