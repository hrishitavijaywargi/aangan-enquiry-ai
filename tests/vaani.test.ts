/** Vaani BYOL adapter: frames shaped like https://docs.vaanivoice.ai/guides/byol */
import { beforeAll, describe, expect, it } from "vitest";
import { PRICING_SCRIPT } from "@/lib/config/business";
import { getDb } from "@/lib/db";
import { ByolSession, type ByolTranscriptEntry } from "@/lib/telephony/vaaniByol";

const WELCOME = "Thank you for calling Aangan Studio, you're speaking with the studio's virtual assistant. How can I help you today?";

/** Build the transcript Vaani would send: system prompt, welcome, then alternating turns. */
function frame(id: number, turns: [string, string][], extraUser?: string) {
  const transcript: ByolTranscriptEntry[] = [
    { role: "system", content: "Vaani agent system prompt (ignored — our rules engine decides)." },
    { role: "assistant", content: WELCOME },
  ];
  for (const [user, agent] of turns) {
    transcript.push({ role: "user", content: user });
    if (agent) transcript.push({ role: "assistant", content: agent });
  }
  if (extraUser) transcript.push({ role: "user", content: extraUser });
  return { interaction_type: "response_required", response_id: id, call_id: "inbound-test", transcript, req_body: { contact_number: "+919000077777" } };
}

beforeAll(async () => {
  await getDb();
});

describe("Vaani BYOL adapter", () => {
  it("records the call as real (not demo), keeps Vaani's spoken welcome, and answers each turn", async () => {
    const s = new ByolSession("inbound-1");
    const r1 = await s.handle(frame(1, [], "Hi, I'm Leela. We have a 3BHK in Baner, about 1,250 sq ft, full redesign of kitchen and bedrooms."));
    expect(r1?.response_id).toBe(1);
    expect(r1?.content_complete).toBe(true);
    expect(r1?.content).toMatch(/\?/); // asks the next question
    const call = await (await getDb()).get("SELECT * FROM calls WHERE id = ?", s.internalCallId) as { provider: string; is_demo: number; enquiry_id: string };
    expect(call.provider).toBe("vaani");
    expect(call.is_demo).toBe(0);
    const first = await (await getDb()).get("SELECT text FROM messages WHERE enquiry_id = ? AND role = 'agent' ORDER BY id LIMIT 1", call.enquiry_id) as { text: string };
    expect(first.text).toBe(WELCOME);
  });

  it("answers pricing questions with the verbatim script, even over the phone", async () => {
    const s = new ByolSession("inbound-2");
    const r = await s.handle(frame(1, [], "How much would a 2BHK in Wakad cost per square foot?"));
    expect(r?.content).toContain(PRICING_SCRIPT);
    expect(r?.content).not.toMatch(/lakh|₹|rupees/i);
  });

  it("only processes NEW caller speech, ignoring repeated lines Vaani re-sends", async () => {
    const s = new ByolSession("inbound-3");
    const a = await s.handle(frame(1, [], "Hi, I'm Ravi."));
    // Vaani re-sends the whole transcript, sometimes with the latest user line duplicated.
    const b = await s.handle({ ...frame(2, [["Hi, I'm Ravi.", a!.content]], "It's a 2BHK in Kothrud."), transcript: [...frame(2, [["Hi, I'm Ravi.", a!.content]], "It's a 2BHK in Kothrud.").transcript, { role: "user" as const, content: "It's a 2BHK in Kothrud." }] });
    expect(b?.response_id).toBe(2);
    const msgs = await (await getDb()).all("SELECT text FROM messages WHERE call_id = ? AND role = 'caller' ORDER BY id", s.internalCallId) as { text: string }[];
    expect(msgs.map((m) => m.text)).toEqual(["Hi, I'm Ravi.", "It's a 2BHK in Kothrud."]);
  });

  it("escalates complaints and asks Vaani to hang up when the conversation ends", async () => {
    const s = new ByolSession("inbound-4");
    const turns: [string, string][] = [];
    const lines = [
      "My project has been going for three months and my designer hasn't replied in five days. This is not acceptable.",
      "Sheetal Deshpande.",
      "No, that's all.",
    ];
    let last;
    for (let i = 0; i < lines.length; i++) {
      last = await s.handle(frame(i + 1, turns, lines[i]));
      turns.push([lines[i], last!.content]);
    }
    expect(last?.end_call).toBe(true);
    const e = await (await getDb()).get("SELECT e.status, e.urgent FROM enquiries e JOIN calls c ON c.enquiry_id = e.id WHERE c.id = ?", s.internalCallId) as { status: string; urgent: number };
    expect(e).toEqual({ status: "escalated", urgent: 1 });
  });

  it("closes the call as 'caller hung up' if the socket closes mid-conversation", async () => {
    const s = new ByolSession("inbound-5");
    await s.handle(frame(1, [], "Hi, I want to redo my flat"));
    await s.close();
    const c = await (await getDb()).get("SELECT status, end_reason FROM calls WHERE id = ?", s.internalCallId) as { status: string; end_reason: string };
    expect(c).toEqual({ status: "completed", end_reason: "caller_hung_up" });
  });

  it("ignores non-turn frames and handles empty speech safely", async () => {
    const s = new ByolSession("inbound-6");
    expect(await s.handle({ interaction_type: "update_only", response_id: 0 })).toBeNull();
    const r = await s.handle(frame(1, []));
    expect(r?.content).toMatch(/say that again/);
  });
});
