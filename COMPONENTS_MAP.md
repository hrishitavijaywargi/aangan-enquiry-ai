# Components Map — Trigger → Input → Context → Processing → AI → Output

*Aangan Studio phone-enquiry automation. Visual version: the "Aangan Enquiry Components Map" artifact. File references point to the implementation.*

```
┌──────────┐   ┌──────────┐   ┌──────────────┐   ┌─────────────────┐   ┌──────────────┐   ┌──────────────────┐
│ TRIGGER  │──►│  INPUT   │──►│   CONTEXT    │──►│   PROCESSING    │──►│      AI      │──►│      OUTPUT      │
│ phone    │   │ caller's │   │ services.md  │   │ extract → merge │   │ Vaani: voice │   │ spoken reply     │
│ rings    │   │ words,   │   │ qualified.md │   │ → qualify (5)   │   │ Claude: gaps │   │ enquiry record   │
│ 24×7     │   │ caller   │   │ pricing.md   │   │ → route reply   │   │ + summary    │   │ email handoff    │
│          │   │ ID, time │   │ prior calls  │   │ → price guard   │   │ (never       │   │ alerts · CRM     │
│          │   │          │   │ settings     │   │                 │   │  decides)    │   │ dashboard + cost │
└──────────┘   └──────────┘   └──────────────┘   └─────────────────┘   └──────────────┘   └──────────────────┘
```

## 1. Trigger
| Component | Implementation | Notes |
|---|---|---|
| Live incoming call | Vaani Voice phone agent `aangan-front-desk` → Bring-Your-Own-LLM WebSocket → `npm run vaani` (`scripts/vaani-byol-server.ts`, `src/lib/telephony/vaaniByol.ts`) | Answers 24×7. Vaani's own language model is disabled (BYOL, no fallback) |
| Demo call | Browser simulator `/calls` → `/api/calls/start` → `answerCall` after a ring delay | 23 scenarios from the Sept 2026 transcripts |
| Twilio (future) | `/api/telephony/twilio/voice` | Off unless configured; signature-verified; untested with a live account |
| Repeat call | `startCall` matches the hashed number within 30 days | Merged into the same enquiry; never double-counted |

## 2. Input
| Input | Source | Handling |
|---|---|---|
| Caller's words | Vaani speech-to-text (English, India) / simulator text | One turn at a time; new lines only (Vaani re-sends the transcript) |
| Caller ID | Telephony provider | Hash for matching + masked display; full E.164 number kept for **live** calls only so the designer can call back |
| Time of call | Server clock | IST, Mon–Sat 10:00–19:00 → after-hours flag |

## 3. Context
| Context | File | Used for |
|---|---|---|
| Service area, out-of-scope types, scope limits, timelines | `services.md` → `src/lib/config/business.ts` | Criteria 1–3 |
| Five criteria, boundary rules, "does NOT disqualify" list | `qualified.md` → `src/lib/qualification.ts` | Qualification decision |
| Internal pricing guide | `pricing.md` → `src/lib/config/pricingInternal.ts` | **Only** to spot a clearly unrealistic *volunteered* budget. Never spoken |
| Approved pricing script, decline line | `pricing.md`, `qualified.md` (verbatim) | Caller-facing text |
| What's already known | Stored enquiry + agent state (earlier calls included) | Never re-ask; resume after dropped calls |
| Cost assumptions, office hours | Settings table (editable on `/settings`) | Cost analytics, after-hours |

## 4. Processing (deterministic, `src/lib/agent.ts`)
1. **Extract** facts with the caller's quote as evidence (`extract.ts`).
2. **Merge**: AI-supplied facts only fill gaps; they never overwrite what the caller said.
3. **Qualify** every turn (`qualification.ts`):
   - C1 Real project: design + execution; not advice, styling, Vastu-only, furniture-only or structural; not restaurant, hotel, retail or gym; offices ≤ ~3,000 sq ft (≥ ~500 from T18 practice, to confirm).
   - C2 Service area: Pune city / PCMC; named out-of-area places fail; unknown places are "unclear".
   - C3 Timeline: completion < 6 weeks fails; < design (3) + execution (8) weeks fails; site unavailable for > 10 weeks fails; flexible passes.
   - C4 Budget: never asked; volunteered < 50% of lowest indicative cost fails (reply has no figures); 50–80% passes with a flag.
   - C5 Decision-maker: owner / joint owner / authorised rep passes; representing owners who will attend passes with a flag; "just research" fails; unknown passes with a flag.
   - Decision: 2+ fails → declined; 1 fail → not qualified; C1–3 unclear → one direct question; else qualified.
4. **Route**: complaint → escalation · pricing question → approved script · fail → graceful close · otherwise the next *missing* question (one per turn, each asked at most once).
5. **Guard** every caller-facing reply (`pricingGuard.ts`).

## 5. AI (constrained)
| Job | Live | Without keys |
|---|---|---|
| Listen and speak | Vaani Voice (STT + TTS); its LLM is switched off by BYOL with no fallback | Browser simulator |
| Fill gaps in extracted facts | Claude (`claude-opus-5-5`, `ANTHROPIC_API_KEY`) | Deterministic extractor |
| Call summary for the designer | Claude | Template summary from the structured record |
| Usage recording | Real token counts from the API | Projected tokens, labelled "Projected — no API call" |

**AI never decides qualification, never writes pricing text, and never sends anything on its own.**

## 6. Output
| Output | Where | Notes |
|---|---|---|
| Spoken reply | Vaani (live) / simulator transcript | One question per turn; clear next steps at the close |
| Enquiry record | Supabase Postgres (`DATABASE_URL`), SQLite locally | Qualified / Not Qualified / Awaiting Information / Escalated + transcript + evidence |
| Designer handoff | Email via Resend (or SMTP) to `HANDOFF_EMAIL_TO` | Contact, project, location, area, scope, site, timeline, budget if volunteered, decision-maker, criteria evidence, gaps, summary, next action, Calendly link |
| Escalation | Email to `ESCALATION_EMAIL_TO` + Telegram alert | URGENT; no sales questions; the AI promises no resolution |
| CRM | HubSpot contact + deal (qualified live leads only) | Pipeline and conversion tracking |
| Dashboard + cost analytics | Next.js on Vercel (`aangan-enquiry-ai.vercel.app`) | Computed from stored rows; demo / estimate / unavailable labels |

Integrations are optional (off until their key is set), run only for live calls, and log what they did on each enquiry.

## 7. Human handoff
- **Designer:** every qualified lead by email; confirms the consultation, judges final fit, and is the only one who prices. *(Nine Checks 07 — judgment protected.)*
- **Studio head:** every complaint and missed follow-up as URGENT (email + Telegram). *(06 — failure risk.)*
- **Nikhil:** owns the rubric; sees every decision with evidence; records consultations and wins so conversion becomes real data. *(09 — owner clear.)*
- **Front desk:** follows up Awaiting Information enquiries.

## 8. Failure handling
| Failure | Behaviour |
|---|---|
| Price asked, even with the area given | Approved script; no range, rate or estimate is ever computed |
| Any reply that looks like a price (including LLM text) | Price guard replaces it with the script |
| Criterion 1–3 still unclear after one question | Awaiting Information, not declined |
| Call drops / caller hangs up | Call closed, enquiry kept; a call-back from the same number resumes it |
| Existing-client complaint | Escalated; no sales questions; no promises |
| BYOL server unreachable during a Vaani call | Vaani stays silent rather than improvising (no fallback LLM) |
| No AI key / AI error / refusal | Deterministic extractor + template summary |
| No email service | Handoff stored as a preview marked "Not sent"; never shown as sent |
| Integration fails (HubSpot, Telegram, Resend) | Logged on the enquiry; the call and handoff are unaffected |
| `DATABASE_URL` missing or malformed | Site stays up on a temporary demo database; Settings explains what to fix (never shows the password) |
| Invalid settings input | Rejected with a readable error; nothing saved |

## 9. Where each part runs
Next.js app + dashboard on **Vercel (Mumbai)** · **Supabase Postgres (Mumbai)** · **Vaani Voice** phone + voice · **BYOL bridge** on the laptop behind a Cloudflare tunnel · **Claude** (optional) · **Resend**, **Telegram**, **HubSpot**, **Calendly** (optional).
