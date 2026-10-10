# Components Map — Trigger → Input → Context → Processing → AI → Output

*Aangan Studio phone-enquiry automation. File references point to the implementation.*

```
┌──────────┐   ┌──────────┐   ┌──────────────┐   ┌─────────────────┐   ┌──────────────┐   ┌──────────────────┐
│ TRIGGER  │──►│  INPUT   │──►│   CONTEXT    │──►│   PROCESSING    │──►│      AI      │──►│      OUTPUT      │
│ phone    │   │ caller   │   │ services.md  │   │ extract → merge │   │ interpret    │   │ spoken reply     │
│ rings    │   │ speech / │   │ qualified.md │   │ → qualify (5)   │   │ gaps +       │   │ enquiry record   │
│          │   │ caller ID│   │ pricing.md   │   │ → next question │   │ summarise    │   │ email handoff    │
│          │   │ time     │   │ prior calls  │   │ → price guard   │   │ (never       │   │ escalation       │
│          │   │          │   │ settings     │   │                 │   │  decides)    │   │ dashboard + cost │
└──────────┘   └──────────┘   └──────────────┘   └─────────────────┘   └──────────────┘   └──────────────────┘
```

## 1. Trigger
| Component | Implementation | Notes |
|---|---|---|
| Incoming call (demo) | Browser simulator → `POST /api/calls/start` → `answerCall` after a ring delay | Response time = answered_at − ring_at, measured and stored per call |
| Incoming call (future live) | Twilio webhook `POST /api/telephony/twilio/voice` (`src/lib/telephony`) | Off unless `TELEPHONY_PROVIDER=twilio` + auth token; signature-verified |
| Repeat call | `startCall` looks up the hashed caller number within the 30-day window | Merged into the same enquiry; `call_count` increments; nothing double-counted |

## 2. Input
| Input | Source | Handling |
|---|---|---|
| Caller utterances | Simulator text / Twilio speech-to-text | Trimmed, max 2,000 chars, stored in `messages` |
| Caller ID | Telephony provider | Stored only as a salted hash (for dedupe) plus a masked display (`+91 ••••• •0017`) |
| Call timestamp | Server clock | Determines after-hours (IST, Mon–Sat 10:00–19:00, configurable) |

## 3. Context
| Context | File | Used for |
|---|---|---|
| Service area, out-of-scope types, minimum/maximum scope, timelines | `services.md` → `src/lib/config/business.ts` | Criteria 1–3 |
| Five criteria + boundary rules + "does NOT disqualify" list | `qualified.md` → `src/lib/qualification.ts` | Qualification decision |
| Internal pricing guide | `pricing.md` → `src/lib/config/pricingInternal.ts` | **Only** to spot a clearly unrealistic *volunteered* budget. Never spoken. |
| Approved pricing script, decline line | `pricing.md`, `qualified.md` (verbatim) | Caller-facing text |
| What's already known | Stored enquiry record + agent state (earlier calls included) | Never re-ask; resume after dropped calls |
| Cost assumptions | Settings table (editable) | Cost analytics |

## 4. Processing (deterministic, `src/lib/agent.ts`)
1. **Extract** facts from the utterance (`extract.ts`): name, location, property, area, rooms, scope, site, timeline, budget (only if volunteered), decision-maker, referral, consultation, pricing question, complaint, missed commitment. Each fact keeps the caller's quote as **evidence**.
2. **Merge** with the record. AI-supplied facts may only **fill gaps**; they can never overwrite what the caller said.
3. **Qualify** (`qualification.ts`), re-run every turn:
   - C1 Real project: design + execution; not advice, styling, Vastu-only, furniture-only or structural; not restaurant, hotel, retail or gym; commercial ≤ ~3,000 sq ft (and ≥ ~500, from T18 practice, to confirm).
   - C2 Service area: Pune city / PCMC list; named out-of-area places fail; unknown places are "unclear".
   - C3 Timeline: completion < 6 weeks fails; < design (3) + execution (8) weeks fails; site not available within 10 weeks fails; "no rush"/flexible passes.
   - C4 Budget: not mentioned → pass (never probed); volunteered < 50% of the lowest indicative cost → fail; 50–80% → pass with flag.
   - C5 Decision-maker: owner, joint owner or authorised rep → pass; representing owners who will attend → pass with flag; "just research for in-laws" → fail; unknown → pass with flag (don't push).
   - Decision: 2+ fails → declined; 1 fail → not qualified; C1–3 unclear → ask one direct question; else qualified.
4. **Route**: complaint → escalation path · pricing question → approved script · fail → graceful close · otherwise ask the next *missing* question (one per turn, each asked at most once).
5. **Guard** every caller-facing reply (`pricingGuard.ts`): any price-like content is replaced by the approved script.

## 5. AI (optional, `src/lib/ai/provider.ts`)
| Job | Live (Anthropic, `ANTHROPIC_API_KEY`) | Demo (no key) |
|---|---|---|
| Interpret an utterance | Claude returns JSON fields, used to fill gaps only | Deterministic extractor (already ran) |
| Call summary for the handoff | Claude writes a 4–6 sentence factual summary | Template summary from the structured record |
| Usage recording | Real token counts from the API response (`is_estimate = 0`) | Projected tokens from text length (`is_estimate = 1`), labelled "Projected — no API call" |

**The AI never decides qualification, never writes pricing text, and never sends anything on its own.**

## 6. Output
| Output | Where | Notes |
|---|---|---|
| Spoken/displayed reply | Simulator transcript (TwiML `<Say>` in live mode) | One question per turn; varied wording; next steps explained at close |
| Enquiry record | SQLite `enquiries`, `calls`, `messages` | Status: Qualified / Not Qualified / Awaiting Information / Escalated |
| Qualified handoff | `handoffs` + email to `HANDOFF_EMAIL_TO` | Contact, project type, location, area, scope, site, timeline, budget if volunteered, decision-maker, 5-criteria evidence, missing info, summary, next action |
| Escalation | `handoffs` (kind `escalation`) to `ESCALATION_EMAIL_TO` | Marked URGENT; no sales questions; agent promises no resolution |
| Dashboard | `/` (`metrics.ts`) | Computed from stored rows; demo, estimate and unavailable values are labelled |
| Cost analytics | `/costs` | AI (recorded vs projected), telephony, email, recurring, per enquiry, per qualified enquiry, monthly projection |

## 7. Human handoff
- **Designer** — gets every qualified lead by email and confirms the consultation. The designer, not the AI, judges final fit and gives pricing.
- **Studio head** — gets every complaint, existing-client issue and missed commitment as URGENT.
- **Nikhil** — sees all decisions with evidence; records consultation and project outcomes so conversion metrics become real data.

## 8. Failure handling
| Failure | Behaviour |
|---|---|
| No `ANTHROPIC_API_KEY` / API error / refusal | Falls back to the deterministic extractor and template summary; logs a system note; status chip shows "Mock AI". Live calls use the server-side refusal fallback (`fallbacks: "default"`). |
| LLM text contains a price | Output guard replaces the whole reply with the approved script (tested). |
| No SMTP credentials | Email written to `data/outbox/<id>.eml`, status **Saved locally — NOT sent**, reason stored. Never shown as sent. |
| SMTP send fails | Status **failed**, error stored, `.eml` kept. |
| Call drops / caller hangs up | Call closed as dropped; enquiry kept as Awaiting Information; a call-back from the same number resumes it. Questions left unanswered on the dropped call can be asked again. |
| Caller declines a question | Recorded; never re-asked; listed in the handoff's missing information. |
| Criterion 1–3 still unclear after one question | Awaiting Information, with a "team will confirm X" close. Not declined. |
| Unknown location name | C2 "unclear" → one direct question ("Is X within Pune city or PCMC?"). |
| Twilio misconfigured | Webhook returns 404 unless explicitly enabled; bad signatures get 403. |
| Invalid settings input | Rejected with a readable error; nothing saved. |
