/** Dev helper: run demo scenarios through the engine and print outcomes. `npx tsx scripts/run-scenarios.ts [key]` */
import { finalOutcome, greet, newSession, processCallerTurn } from "../src/lib/agent";
import { SCENARIOS, istToDate, scenarioReply } from "../src/lib/seed/scenarios";

const only = process.argv[2];
for (const sc of SCENARIOS.filter((s) => !only || s.key.includes(only))) {
  const ctx = { now: istToDate(sc.startedAtIst), settings: { festivalDates: { diwali: "2026-11-08" }, officeStartHour: 10, officeEndHour: 19, workingDays: [1, 2, 3, 4, 5, 6] } };
  let r = greet(newSession(), ctx);
  const log = [`A: ${r.reply}`];
  for (let turn = 0; turn < 16 && !r.ended; turn++) {
    if (sc.hangUpAfterTurns !== undefined && turn >= sc.hangUpAfterTurns) { log.push("  (caller hangs up)"); break; }
    const line = scenarioReply(sc, r.session.state.lastQuestion, turn)!;
    r = processCallerTurn(r.session, line, ctx);
    log.push(`C: ${line}`, `A: ${r.reply}  [${r.events.join(",")}]`);
  }
  const o = finalOutcome(r.session, ctx.now);
  console.log(`=== ${sc.key} → ${o.status.toUpperCase()} | ${o.qualification.criteria.map((c) => `${c.id}:${c.status}`).join(" ")} | Qs ${r.session.state.questionsAsked.length} ${r.ended ? "ended" : "OPEN"}`);
  if (only) console.log(log.join("\n"));
}
