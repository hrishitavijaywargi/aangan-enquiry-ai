import { handler } from "@/lib/api";
import { count } from "@/lib/db";
import { scenarioByKey, scenarioReply } from "@/lib/seed/scenarios";
import { getCall, getEnquiry } from "@/lib/service";
import type { AgentState } from "@/lib/types";

/** For scenario calls: what the simulated caller would say next, given what the agent just asked. */
export const GET = handler(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const call = await getCall((await params).id);
  if (!call) throw new Error("Call not found");
  const sc = call.scenario_key ? scenarioByKey(call.scenario_key) : undefined;
  if (!sc) return { text: null };
  const e = (await getEnquiry(call.enquiry_id))!;
  const state = JSON.parse(e.agent_state) as AgentState;
  const turns = await count("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM messages WHERE call_id = ? AND role = 'caller'", call.id);
  const hangUp = sc.hangUpAfterTurns !== undefined && turns >= sc.hangUpAfterTurns;
  return { text: hangUp ? null : scenarioReply(sc, state.lastQuestion, turns), hangUp };
});
