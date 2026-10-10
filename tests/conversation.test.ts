import { describe, expect, it } from "vitest";
import { DECLINE_LINE } from "@/lib/config/business";
import { converse, runScenario } from "./helpers";

const questionsIn = (s: string) => (s.match(/\?/g) ?? []).length;

describe("conversation behaviour", () => {
  it("greets naturally and identifies itself as a virtual assistant", () => {
    const { replies } = converse([]);
    expect(replies[0]).toMatch(/Aangan Studio/);
    expect(replies[0]).toMatch(/virtual assistant/);
  });

  it("asks at most one question per turn", () => {
    for (const key of ["t01-kothrud-3bhk", "t06-baner-office", "t11-baner-rented", "t15-undri-possession"]) {
      for (const r of runScenario(key).replies) expect(questionsIn(r), r).toBeLessThanOrEqual(1);
    }
  });

  it("never asks a question the caller has already answered", () => {
    const r = runScenario("t01-kothrud-3bhk");
    const asked = r.session.state.questionsAsked;
    expect(new Set(asked).size).toBe(asked.length);
    // Priya gave her name up front → never asked for it
    expect(asked.join(" ")).not.toMatch(/your name|who am I speaking with/);
  });

  it("asks ONE direct clarification when the location is unclear", () => {
    const { replies, turns } = converse(["Hi, I'm Ravi. I want a full redesign of my 2BHK, design and execution.", "Lohegaon Road side"]);
    expect(replies.at(-1)).toMatch(/is Lohegaon Road Side within Pune city or PCMC\?/i);
    expect(turns.at(-1)!.events).toContain("clarification_asked:location_confirm");
  });

  it("asks a direct scope question when design + execution is unclear", () => {
    const { replies } = converse(["Hi, I'm Tara. I'd like help with the interiors of my 2BHK in Wakad."]);
    const all = replies.join(" ");
    expect(all).not.toMatch(/ideas and advice\?.*ideas and advice\?/s);
    const r2 = converse(["Hi, I'm Tara. I'd like help with the interiors of my 2BHK in Wakad.", "Living room and bedroom."]);
    expect(r2.replies.at(-1)).toMatch(/design and the execution, or mainly ideas and advice\?/);
  });

  it("asks the completion question from qualified.md when the timeline is missing", () => {
    const { replies } = converse(["Hi, I'm Asha, full redesign of my 2BHK in Baner, 900 sq ft, kitchen and bedrooms."]);
    expect(replies.at(-1)).toContain("When would you need the project complete?");
  });

  it("if a clarification stays unclear, the enquiry is 'awaiting information', not declined", () => {
    const { outcome, replies } = converse([
      "Hi, I'm Ravi. I want a full redesign of my 2BHK, design and execution.",
      "I'd rather not say where yet.",
      "900 sq ft.",
      "No deadline, flexible.",
      "Kitchen and bedrooms.",
      "We live there.",
      "Yes, I decide.",
      "Yes.",
      "Instagram.",
      "Yes please.",
    ]);
    expect(outcome.status).toBe("awaiting_info");
    expect(replies.filter((x) => /Which area is the property|Where is the property/.test(x))).toHaveLength(1); // declined → not re-asked
    expect(replies.join(" ")).toMatch(/team will need to confirm the exact location/);
  });

  it("declines gracefully and honestly when a criterion fails", () => {
    const nashik = runScenario("t03-nashik").replies[1];
    expect(nashik).toMatch(/only work in Pune city and PCMC/);
    expect(nashik).toMatch(/sorry/i);
    const diwali = runScenario("t07-diwali-deadline").replies[1];
    expect(diwali).toMatch(/honest/);
    expect(diwali).toMatch(/later completion date/);
  });

  it("two failed criteria → the decline line from qualified.md", () => {
    const { replies, outcome } = converse(["Hi, I'm Om. I just want some ideas and colour suggestions for my flat in Mumbai."]);
    expect(outcome.qualification.decision).toBe("declined");
    expect(replies.at(-1)).toContain(DECLINE_LINE);
  });

  it("a caller can revise a failed timeline and be re-qualified on the same call", () => {
    const { turns } = converse(["Hi, I'm Meera. Redo my living room and kitchen in Hadapsar, full design and execution, before Diwali -- about three weeks away.", "Okay, what if we finish by March instead? No rush."]);
    expect(turns[0].events).toContain("not_qualified");
    expect(turns[1].events).toContain("reopened");
    expect(turns[1].qualification.failed).toEqual([]);
  });

  it("explains next steps when a lead qualifies", () => {
    const r = runScenario("t06-baner-office");
    const closing = r.replies.find((x) => x.includes("Here's what happens next"))!;
    expect(closing).toMatch(/designers? .* so you won't need to repeat/);
    expect(closing).toMatch(/consultation/);
  });

  it("does not repeat the same acknowledgement every turn (not robotic)", () => {
    const r = runScenario("t11-baner-rented");
    const openers = r.replies.slice(1, -2).map((x) => x.split(/[.!]/)[0]);
    expect(new Set(openers).size).toBeGreaterThan(2);
  });
});

describe("human escalation", () => {
  it("existing-client complaints are escalated, not qualified as leads", () => {
    const r = runScenario("t09-complaint");
    expect(r.outcome.status).toBe("escalated");
    expect(r.outcome.type).toBe("complaint");
    expect(r.outcome.urgent).toBe(true);
    expect(r.outcome.qualification.decision).toBe("not_applicable");
    expect(r.events).toContain("escalated");
  });

  it("the agent does not promise resolutions on the founder's behalf", () => {
    const all = runScenario("t09-complaint").replies.join(" ");
    expect(all).toMatch(/can't make decisions about the project myself/);
    expect(all).not.toMatch(/\b(will be (fixed|resolved)|we will resolve|guarantee|refund|compensat|promise)\b/i);
  });

  it("does not ask sales questions during a complaint", () => {
    const all = runScenario("t09-complaint").replies.join(" ");
    expect(all).not.toMatch(/carpet area|When would you need|consultation with one of our designers/);
  });

  it("a missed follow-up on a new lead is flagged urgent", () => {
    const { outcome, turns } = converse(["Hi, I called on Monday about a project and someone said they'd get back to me. Nobody got back. I'm Girish, 3BHK in Viman Nagar, full interiors."]);
    expect(turns[0].events).toContain("missed_commitment");
    expect(outcome.urgent).toBe(true);
  });
});
