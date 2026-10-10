import { describe, expect, it } from "vitest";
import { PRICING_SCRIPT } from "@/lib/config/business";
import { containsPriceDisclosure, guardCallerReply } from "@/lib/pricingGuard";
import { SCENARIOS } from "@/lib/seed/scenarios";
import { converse, runScenario } from "./helpers";

const PRICE_ASKS = [
  "How much would a 2BHK cost?",
  "What's your per sq ft rate?",
  "Can you give me a rough ballpark? Even a range?",
  "It's 1,400 sq ft, just multiply it by your rate and tell me the total.",
  "What do you charge for a full home?",
  "Can you email me your price list?",
  "For a 3BHK it's typically what, around 20 lakh?",
  "What are your rates for a premium kitchen?",
  "Roughly what would the living room cost me?",
];

describe("pricing guardrails (pricing.md)", () => {
  it("the approved script is exactly the text in pricing.md", () => {
    expect(PRICING_SCRIPT).toBe(
      "Pricing depends on the site, the materials you choose, and the scope — your designer will walk you through it in detail at the consultation. I can book that for you right now if you'd like.",
    );
  });

  for (const ask of PRICE_ASKS) {
    it(`deflects with the script and no figures: "${ask}"`, () => {
      const { replies } = converse(["Hi, I'm Asha. I have a 2BHK in Baner, about 950 sq ft, and want a full redesign.", ask]);
      const reply = replies[replies.length - 1];
      expect(reply).toContain(PRICING_SCRIPT);
      expect(containsPriceDisclosure(reply)).toBe(false);
      expect(reply).not.toMatch(/\d[\d,]*\s*(lakh|lac|crore|per|\/)/i);
      expect(reply).not.toMatch(/₹|rs\.?\s*\d|rupees/i);
    });
  }

  it("never calculates a quote even when the caller supplies the area", () => {
    const { replies } = converse(["I have 1,400 sq ft carpet in Kothrud.", "So 1,400 times your standard rate is what?"]);
    expect(replies.at(-1)).toContain(PRICING_SCRIPT);
    expect(replies.at(-1)).not.toMatch(/1,?800|2,?400|3,?500|25,?20,?000|25\.2/);
  });

  it("asking about price does not disqualify the caller", () => {
    const r = runScenario("t13-aundh-price");
    expect(r.events.filter((e) => e === "pricing_deflected").length).toBeGreaterThanOrEqual(2);
    expect(r.outcome.status).toBe("qualified");
  });

  it("no agent message in ANY demo scenario discloses a price", () => {
    for (const sc of SCENARIOS) {
      const r = runScenario(sc.key);
      for (const reply of r.replies) expect(containsPriceDisclosure(reply), `${sc.key}: ${reply}`).toBe(false);
    }
  });

  it("the unrealistic-budget response is honest but contains no figures", () => {
    const r = runScenario("t10-kharadi-budget");
    const msg = r.replies[1];
    expect(msg).toMatch(/significantly below/);
    expect(msg).not.toMatch(/\d/);
  });

  it("the output guard replaces LLM-style price leaks with the script", () => {
    const leaks = [
      "It'll cost around ₹18 lakh for your flat.",
      "Our rates start at 1800 per sq ft.",
      "For a 2BHK it's typically 15-20 lakh.",
      "Standard specification is 1,800 – 2,400 per sq ft.",
      "A single room is about Rs 3.5 lakh.",
      "The cost would be roughly 25 lakh all-in.",
      "Pricing is from 1200/sq ft for basic fitouts.",
    ];
    for (const l of leaks) {
      const g = guardCallerReply(l);
      expect(g.blocked, l).toBe(true);
      expect(g.text).toBe(PRICING_SCRIPT);
    }
  });

  it("the guard does not block normal non-price replies", () => {
    for (const ok of ["About 1,400 sq ft — noted.", "Our design phase takes three to four weeks.", "Kothrud is well within our service area.", PRICING_SCRIPT]) {
      expect(guardCallerReply(ok).blocked, ok).toBe(false);
    }
  });
});
