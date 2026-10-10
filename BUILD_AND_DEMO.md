# Build & Demo Guide — Aangan Studio Enquiry Assistant

## 1. Requirements
- **Node.js 22.13 or newer** (built and tested on Node 24). The app uses Node's built-in `node:sqlite`, so there is no native database driver to compile.
- npm (comes with Node). No paid services, API keys or phone numbers are needed for demo mode.

## 2. Install & run
```bash
npm install
```
```bash
npm run dev
```
Open **http://localhost:3000**. On first load the database (`data/aangan.db`) is created and seeded automatically with demo data (takes a second or two).

Production build (optional; stop `npm run dev` first, because both use the `.next` folder):
```bash
npm run build
```
```bash
npm start
```

## 3. Environment variables (all optional)
Copy `.env.example` to `.env.local` and fill in only what you want to enable. Secrets are read server-side only and never sent to the browser.

| Variable | Effect |
|---|---|
| `AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` | Live Claude for field interpretation and call summaries (default model `claude-opus-5-5`, override with `ANTHROPIC_MODEL`). Without a key → deterministic mock AI. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | Real email delivery of handoffs. Without them → `.eml` files in `data/outbox/`, clearly marked **not sent**. |
| `HANDOFF_EMAIL_TO`, `ESCALATION_EMAIL_TO` | Recipients for qualified leads and escalations. |
| `TELEPHONY_PROVIDER=twilio` + `TWILIO_AUTH_TOKEN` (+ `PUBLIC_BASE_URL`) | Enables the Twilio voice webhook at `/api/telephony/twilio/voice`. Not needed for the demo. |

The top bar always shows the current mode: **Simulated calls · Mock AI · Email: local only** (amber) or the live equivalents (green).

## 4. Tests
```bash
npm test
```
96 automated tests (Vitest) in `tests/`:
- `qualification.test.ts`: every Sept 2026 scenario reaches the right outcome; each of the five criteria; unknown budget; authorised representatives; "does NOT disqualify" rules; the AI can't override the engine.
- `pricing.test.ts`: the approved script is verbatim; 9 kinds of price question are deflected with no figures; no quote even when area is given; no price in any agent message across all scenarios; the output guard blocks LLM-style leaks.
- `conversation.test.ts`: one question per turn; no repeated questions; one direct clarification; awaiting-information path; graceful declines; re-qualification when the caller changes timeline; complaint escalation with no promises; missed-commitment flag.
- `system.test.ts`: dashboard totals equal database counts; filters; conversion shown as unavailable; repeat-call merging; full call → handoff with all required sections; cost maths; missing SMTP / API key / Twilio token handled safely; settings validation.

Type check: `npm run typecheck`.

## 5. Architecture
```
Browser (Next.js pages, Tailwind, Recharts)
  ├─ /            Dashboard: filters, metric cards, 4 charts → GET /api/metrics
  ├─ /calls       Call simulator → /api/calls/start | /{id}/answer | /{id}/say | /{id}/suggest | /{id}/end
  ├─ /enquiries   List + filters; /enquiries/[id] transcript, evidence, record, handoff, outcomes
  ├─ /handoffs    Email previews, Send (SMTP or local .eml)
  ├─ /costs       Cost analytics, per-call breakdown
  └─ /settings    Integration status, cost assumptions, reset demo data
Server (Next.js route handlers, Node runtime)
  src/lib/service.ts        call workflow: startCall → answerCall → callerSays → endCall → createHandoff
  src/lib/agent.ts          conversation engine (pure, deterministic)
  src/lib/extract.ts        utterance → structured facts + evidence quotes
  src/lib/qualification.ts  the five criteria from qualified.md
  src/lib/pricingGuard.ts   approved script + output guard
  src/lib/handoff.ts        email handoff note (text + HTML)
  src/lib/email/mailer.ts   SMTP via nodemailer, or local .eml outbox
  src/lib/ai/provider.ts    Anthropic (optional) / mock; usage recording
  src/lib/telephony/        provider boundary + Twilio signature check + TwiML
  src/lib/metrics.ts        dashboard and cost calculations (pure)
  src/lib/db/               SQLite schema (node:sqlite)
  src/lib/seed/             Sept 2026 scenarios → seeded through the real workflow
```
Demo data is **not** hand-written rows. Each scenario is played through the same workflow a live call uses, with the transcript's date and time, so the dashboard numbers are genuinely computed.

## 6. Demo script for faculty (about 10 minutes)
1. **Dashboard (`/`)**: point out the amber **Demo mode** banner and the provenance tags (Demo data / Estimate / Unavailable). Show 22 enquiries from 24 calls ("2 repeat calls merged"), 100% answered within 5 minutes, and *Projects won: Unavailable* (not assumed). Change the **Status** filter to Escalated and the **Enquiry type** to Commercial to show the filters work.
2. **Calls → T13 Deepa (price asked twice)**: Start demo call → watch it ring and get answered (response time badge) → **Auto-play caller**. Point out the verbatim pricing script both times, the live *Information collected* panel, and the five criteria turning green with quoted evidence. The call ends **Qualified** and the handoff shows *saved locally, NOT sent*.
3. **Custom caller, live**: type *"Hi, I'm Asha, 2BHK in Baner, 950 sq ft, full redesign. Just multiply 950 by your rate — what's the total?"*. It deflects with no number.
4. **Calls → T07 (Diwali deadline)**: graceful, honest decline on criterion 3. Then type *"What if we finish by March instead?"* and it re-qualifies on the same call.
5. **Calls → T09 (complaint)**: Escalated; no sales questions; *"I can't make decisions about the project myself"*. Open the URGENT escalation email.
6. **Enquiries**: open **ENQ-1010 (Vikas, ₹1–1.5 lakh)**. The budget criterion fails, with the honest response and no figures. Open **Girish N.**: 2 calls merged, missed-commitment flag, PRIORITY handoff.
7. **Handoffs**: show the formatted designer email (all required sections, evidence, missing info, next action). Click **Send email** and show the honest result: *Not sent — SMTP_HOST is not set… saved as data/outbox/….eml*.
8. **Cost Analytics**: projected (mock) vs recorded token labels, telephony at the configured rate, cost per enquiry and per qualified enquiry, monthly projection at 200 enquiries. **Settings**: change the telephony rate and the costs update.
9. **Enquiry detail → After the call**: set a consultation to *Completed* and a project to *Won*. The dashboard's conversion cards switch from Unavailable to recorded values.
10. **Settings → Reset demo data** to restore the starting state.
11. Optional: run `npm test` to show 96 passing tests.

## 7. Limitations (be upfront about these)
- **No real phone calls.** Calls are simulated in the browser. The Twilio adapter is implemented (webhook, signature check, speech `<Gather>`) but **has not been tested against a live Twilio account**. Real voice also needs latency tuning and Hindi/Marathi handling.
- **Mock AI by default.** The deterministic extractor handles the case transcripts well but is pattern-based; unusual phrasing may need a live LLM, which is optional and gap-filling only.
- **Consultation "booking" is a request**, not a calendar booking. The designer confirms the slot.
- **Costs are estimates**: configured rates × recorded usage. In mock mode, token counts are projections. No billing APIs are connected.
- **Assumptions to confirm with Nikhil**: commercial minimum ~500 sq ft (from T18 practice, not `services.md`); budget "clearly below" threshold (< 50% of the lowest indicative cost); adjoining-area locality list; working days Mon–Sat (transcripts show Saturday calls answered; W05 says closed weekends).
- **Conversion and revenue** stay "Unavailable" until outcomes are recorded on enquiries; nothing is inferred.
- **Demo data** is adapted from anonymised transcripts. Names are shown as first name + initial in lists, phone numbers are fake (`+91 90000 1xxxx`), and two scenarios (after-hours T08 content, unauthorised caller) are marked as adapted.
- Single-user local app: there's no login or role-based access, which a production deployment would need.
- The MESA student invite-code spreadsheet supplied with the brief contains no assignment data and was not used.
