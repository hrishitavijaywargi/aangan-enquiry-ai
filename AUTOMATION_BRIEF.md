# Automation Brief — Aangan Studio phone enquiries

*MESA Case 03 · Founder's Office · prepared for Nikhil Deshpande, Founder*
*Sources: `MESA_Case 03_Problem Statement.pdf`, `Aangan_Sep 2026_Enquiries.pdf`, `services.md`, `qualified.md`, `pricing.md`*

---

## 1. Why

### Pain
| Evidence (from the case) | What it costs Aangan |
|---|---|
| ~200 enquiries / month; **~48% get no response within 48 hours** | Roughly 96 enquiries a month are effectively ignored for two days or more. |
| **Answered < 1 hr converts at 4×** the rate of next-day replies | Every slow answer throws away most of that enquiry's chance of becoming a project. With an average project value of ₹8–14 lakh, a few lost conversions a month is significant revenue. |
| **~33% arrive outside 10am–7pm**; the front desk is 2 people | A third of demand lands when nobody can answer. T08 (10:47 pm) went unanswered; the call-back the next morning got no reply. |
| Designers get **forwarded messages with no context** and spend the first call re-asking questions | Designer time (14 designers) is spent on admin, and the client experience starts with repetition. |
| Follow-ups fall through: T16 (Girish N.) called Monday, nobody called back, had to call again Friday; W08 waited 4 days | Leads are lost or arrive frustrated ("this is not a good sign if you forget before you even start"). |
| Existing-client complaints (T09) arrive on the same line as new leads | Urgent issues risk sitting in the same queue as sales enquiries. |
| Nikhil "pulled his own numbers manually last month" | The founder has no live view of response times, outcomes or the cost of handling enquiries. |

### User
- **Primary — the caller**: a homeowner or small-business owner in Pune/PCMC calling about an interior project, often in the evening, often referred by a friend.
- **Secondary — the designer** who receives the qualified lead, and the **studio head** who receives escalations.
- **Owner of the outcome — Nikhil**, who wants speed, well-qualified handoffs and a dashboard showing performance and cost.

### Desired outcome
1. **Every phone enquiry answered within five minutes, day or night** (measured: ring → answer).
2. **Qualified leads reach a designer with everything already asked**, as a structured handoff note.
3. **Unsuitable enquiries are closed politely and honestly**, using Nikhil's own five criteria (`qualified.md`), not the agent's judgement.
4. **Complaints and missed commitments go to a human immediately**, never treated as sales leads.
5. **A dashboard** shows volume, outcomes, response times, AI and operating costs, cost per enquiry, and cost per qualified enquiry, all calculated from stored records.
6. **No pricing is ever quoted** (`pricing.md`).

---

## 2. Current enquiry journey (phone, as-is)

```
Caller rings studio number
   │
   ├── 10am–7pm, desk free ──► Front desk answers ──► asks questions ad hoc (no standard set)
   │                                │
   │                                ├─ price asked → front desk deflects (T02, T13), sometimes repeatedly
   │                                ├─ unsuitable → declined verbally (T03, T04, T07, T10, T18, T19)
   │                                └─ suitable → "let me check the calendar and revert" (T12)
   │                                               │
   │                                               └─► forwarded message to a designer (no context)
   │                                                      └─► designer re-asks the same questions
   │
   ├── desk busy / after hours ──► MISSED CALL (T08, 10:47 pm) ──► call-back next day, often no answer
   │
   └── call drops mid-way ──► caller must call again (T17); first contact may never be logged (T16)

Founder: no system of record → numbers pulled manually, once a month.
```

**Failure points**: after-hours gap · inconsistent questions · no structured record · forwarded messages without context · no follow-up tracking · complaints mixed with leads · no cost or performance visibility.

---

## 3. Proposed automated journey (phone only — this build)

```
Caller rings studio number (any time)
   │
   ▼
AI front-desk agent answers in seconds (discloses it is the studio's virtual assistant)
   │  • repeat caller within 30 days? → merged into the existing enquiry (not double-counted)
   ▼
Natural conversation — one question at a time, never re-asking what's known
   │  • price asked → approved script from pricing.md, verbatim, every time; never a number
   │  • complaint / existing client → escalation path (no sales questions, no promises)
   ▼
Deterministic qualification engine re-evaluates the 5 criteria after every answer
   │  • 1, 2 or 3 unclear → one direct question
   │  • 4 or 5 unclear → don't push; treat as pass and flag
   │  • 1 fail → honest, graceful close · 2+ fails → qualified.md decline line
   ▼
Outcome recorded: Qualified · Not Qualified · Awaiting Information · Escalated
   │
   ├─ Qualified ──► structured EMAIL handoff to designers (contact, scope, site, timeline,
   │                budget if volunteered, decision-maker, 5-criteria evidence, gaps, summary,
   │                recommended next action) + consultation request with preferred slot
   ├─ Escalated ──► URGENT email to studio head; caller told a senior person has the details
   ├─ Awaiting ───► record kept; team follows up on the one open question
   └─ Not qualified ► polite close; reason logged for the dashboard
   ▼
Dashboard updates live: volume, outcomes, response time, % within 5 min, consultations,
AI / telephony / email / recurring cost, cost per enquiry and per qualified enquiry.
```

**Why email (not Telegram) for the handoff.** The designer needs a complete, readable record they can refer back to, forward to colleagues, and keep with the project thread. Email holds a long structured note with headings, sits in the studio's existing workflow, is searchable, and doesn't depend on one person's phone. Telegram suits short alerts, but a 15-field brief in chat scrolls away and mixes with personal messages. Urgent escalations are flagged in the subject line and email priority. A Telegram or WhatsApp *ping* that links to the email is a sensible later add-on.

### Future extensions (out of scope for this build)
- WhatsApp Business and website form as additional channels feeding the **same** engine (`processCallerTurn` is channel-agnostic; a form submission is just a pre-filled turn).
- Real calendar booking (Google/Outlook) instead of a "consultation requested + preferred slot" note.
- Live telephony via the included Twilio webhook adapter, after testing with a real account.
- CRM sync and automatic outcome tracking (consultation held, project won) to make conversion metrics automatic.
