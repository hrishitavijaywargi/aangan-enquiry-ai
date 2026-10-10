# Aangan Studio — AI Phone Enquiry Assistant

MESA Case 03 (Founder's Office). A working, demo-ready app that answers incoming phone enquiries for Aangan Studio, Pune. It holds a natural conversation, qualifies leads against Nikhil's five criteria, never quotes prices, emails structured handoffs to designers, escalates complaints, and shows a founder dashboard with performance and operating cost.

```bash
npm install
```
```bash
npm run dev
```
Then open http://localhost:3000 (Node.js 22.13+). Runs fully in demo mode with no API keys.

| Document | Contents |
|---|---|
| [BUILD_AND_DEMO.md](BUILD_AND_DEMO.md) | Install, configure, test, architecture, **faculty demo script**, limitations |
| [AUTOMATION_BRIEF.md](AUTOMATION_BRIEF.md) | Why (pain, user, outcome), current journey, automated journey, email-vs-Telegram choice |
| [NINE_CHECKS.md](NINE_CHECKS.md) | All nine checks (Kill Switches · Sizing · Boundary) with case evidence; the Cut: per-sq-ft price quoting, killed by 07 |
| [COMPONENTS_MAP.md](COMPONENTS_MAP.md) | Trigger → Input → Context → Processing → AI → Output, rules, handoff, failure handling |

Tests: `npm test` (110 tests). Reset demo data: Settings → *Reset demo data*, or `npm run reset-demo` (with the dev server stopped).
