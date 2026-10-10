import { finalOutcome, greet, newSession, processCallerTurn, type Session, type TurnResult } from "@/lib/agent";
import { SCENARIOS, istToDate, scenarioReply } from "@/lib/seed/scenarios";

export const SETTINGS = { festivalDates: { diwali: "2026-11-08" }, officeStartHour: 10, officeEndHour: 19, workingDays: [1, 2, 3, 4, 5, 6] };
export const ctxAt = (iso = "2026-09-15T05:00:00Z") => ({ now: new Date(iso), settings: SETTINGS });

/** Drive a conversation with explicit caller lines. */
export function converse(lines: string[], iso?: string) {
  const ctx = ctxAt(iso);
  let r: TurnResult = greet(newSession(), ctx);
  const replies = [r.reply];
  const turns: TurnResult[] = [];
  for (const l of lines) {
    if (r.ended) break;
    r = processCallerTurn(r.session, l, ctx);
    replies.push(r.reply);
    turns.push(r);
  }
  return { last: r, replies, turns, outcome: finalOutcome(r.session, ctx.now) };
}

/** Run a demo scenario (caller answers whatever is asked). */
export function runScenario(key: string) {
  const sc = SCENARIOS.find((s) => s.key === key)!;
  const ctx = { now: istToDate(sc.startedAtIst), settings: SETTINGS };
  let r: TurnResult = greet(newSession(), ctx);
  const replies = [r.reply];
  const events: string[] = [...r.events];
  for (let t = 0; t < 18 && !r.ended; t++) {
    if (sc.hangUpAfterTurns !== undefined && t >= sc.hangUpAfterTurns) break;
    r = processCallerTurn(r.session, scenarioReply(sc, r.session.state.lastQuestion, t)!, ctx);
    replies.push(r.reply);
    events.push(...r.events);
  }
  return { session: r.session as Session, replies, events, outcome: finalOutcome(r.session, ctx.now) };
}
