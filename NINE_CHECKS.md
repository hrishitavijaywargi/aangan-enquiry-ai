# The Nine Checks — Does Aangan's phone-enquiry automation deserve to be built?

*Framework: MESA Lecture 1, "The Nine Checks — Does This Deserve to Be Built?"*
*Evidence: `MESA_Case 03_Problem Statement.pdf`, `Aangan_Sep 2026_Enquiries.pdf` (T = phone, W = WhatsApp, F = web form), `services.md`, `qualified.md`, `pricing.md`.*

| Group | Checks | Rule |
|---|---|---|
| **Kill Switches** | 01 · 02 · 03 | Any **No** → don't build it |
| **Sizing** | 04 · 05 · 08 | Any **No** → build something smaller |
| **Boundary** | 06 · 07 · 09 | Any **No** → put a human exactly here |

---

## Kill Switches

**01 · Problem real? — YES.**
Nikhil pulled the numbers himself: ~200 enquiries a month, **~48% get no response within 48 hours**, and an enquiry answered within an hour **converts at 4×** the rate of a next-day reply. The transcripts show the cost. T08 (10:47 pm) was a missed call, and the next-morning call-back got no answer. Girish (T16) called Monday, nobody called back, and he had to call again: *"This is not a good sign if you forget before you even start."* W05 was lost after a weekend with no reply. W08 waited four days.

**02 · Workflow repeated? — YES.**
About 200 enquiries a month (~7 a day), and the phone calls follow the same script every time: where is it → what scope → how big → when → are you the owner → book. T01, T02, T05, T06, T15, T17 and T20 are near-identical conversations. The same five criteria (`qualified.md`) decide every call.

**03 · Input available? — YES.**
Everything needed is either said by the caller on the call (location, property, area, rooms, site condition, timeline, decision-maker) or already written down: the service area, out-of-scope types and timelines in `services.md`, and the five criteria plus boundary rules in `qualified.md`. *Caveat:* callers are sometimes vague ("near Pune" F03, "just exploring" W10, "my parents will decide" T14), so the system has an explicit *unclear* state and asks one direct question rather than guessing.

## Sizing

**04 · Output valuable? — YES.**
Two outputs that matter on the day of the call. (1) The caller gets answered in seconds, day or night, which is where the 4× conversion lives. (2) The designer gets a structured email handoff with everything already asked: contact, scope, area, site readiness, timeline, decision-maker, the evidence for each criterion, and what's still missing. That fixes *"the designer's first call is spent asking questions the front desk already asked."*

**05 · Impact measurable? — YES.**
Every call records ring time, answer time, duration, outcome and cost. The dashboard shows % answered within five minutes (target 100%, against today's ~48% unanswered in 48 h), average time to answer, outcomes, consultations requested, cost per enquiry and cost per qualified enquiry. Conversion is measurable once consultation and project outcomes are recorded on each enquiry; until then it shows **Unavailable** rather than an assumed number.

**08 · ROI worth it? — YES.**
Average project value is ₹8–14 lakh. At the configured demo assumptions the app projects roughly **₹3,300/month** to run 200 enquiries (AI + telephony + email + recurring; an *estimate* from the Cost Analytics page that changes with the rates in Settings). One additional converted project a year covers that many times over. The build reuses the front desk's existing script and Nikhil's own rubric, so there's no new process to design.

## Boundary — where a human sits

**06 · Failure risk OK? — YES, with three boundaries.**
| Possible failure | Worst case | Boundary built in |
|---|---|---|
| Wrongly declining a good lead | Lost project | Declines only on an explicit rule failure from `qualified.md`. Unclear answers get one direct question, then *Awaiting Information*, never a decline. Criteria 4–5 are never pushed (treated as pass and flagged). Every decision is shown to Nikhil with the caller's own words as evidence. |
| Mishandling an existing client's complaint (T09) | Damaged relationship | Detected and escalated; no sales questions, no promises. URGENT email to the studio head. |
| **Telling a caller a price** | Wrong anchor, broken trust, mis-sold project | **Not OK → cut (see below).** |

**07 · Judgment protected? — YES for qualification, NO for pricing.**
Qualification uses Nikhil's own rubric (*"This is my rubric — use this to decide"*), and *"the designer establishes fit at the consultation."* The AI only applies the written rules and hands over; the designer still judges. **Pricing is the designer's judgment**: *"All pricing is confirmed by the assigned designer at the consultation"* (`pricing.md`). Resolving a complaint is the studio's judgment, not the AI's.

**09 · Owner clear? — YES.**
Nikhil asked the founder's office to own this, and he owns the rubric. Designers own consultations and pricing. The studio head owns escalations. The front desk owns follow-ups on *Awaiting Information* enquiries.

---

## The Cut

> **"…the system should be able to quote our standard per-square-foot pricing so people don't have to wait for that."** (Nikhil)
>
> **Killed by 07.** Pricing is the designer's judgment, made after seeing the site and the spec. **Also fails 06**: a phone-call figure is the riskiest thing the system could say. The AI answers and qualifies; the designer prices.

**Evidence**
- `pricing.md`: *"indicative only… **No number from this guide should be quoted to a client.** All pricing is confirmed by the assigned designer at the consultation."* It also lists what must never be said: any number, range or per-sq-ft figure; "It'll cost around…"; "Our rates start at…"; "For a 2BHK it's typically…".
- `pricing.md`, what affects pricing: site condition, custom-furniture ratio, material brands and timeline compression all move the figure significantly.
- T13, front desk: *"The difference between a standard and a premium kitchen alone can be **3×** the cost."* T02: *"Giving you a number without seeing the site would be **misleading**."*
- `qualified.md`: asking about price does **not** disqualify a caller. Deflect and book; don't answer.

**What we build instead (implemented and tested)**
1. Every pricing question gets the **approved script from `pricing.md`, word for word**: *"Pricing depends on the site, the materials you choose, and the scope — your designer will walk you through it in detail at the consultation. I can book that for you right now if you'd like."* The call then carries on towards a consultation, which meets Nikhil's real goal that people shouldn't have to wait.
2. An **output guard** checks every sentence the agent says, including anything an LLM writes, and replaces anything price-like with the script (`src/lib/pricingGuard.ts`; 16 tests in `tests/pricing.test.ts`).
3. The internal guide is used only to spot a **volunteered** budget that is clearly unrealistic (`qualified.md` criterion 4, T10). The caller hears an honest, figure-free answer.
4. The designer's handoff email flags *"Caller asked about pricing — walk them through it at the consultation."*

**Also restricted (same boundary logic):** the AI records *consultation requested + preferred time* but does not confirm a calendar slot. The designer confirms (06/09: a time the studio hasn't agreed to is a promise the system can't keep).
