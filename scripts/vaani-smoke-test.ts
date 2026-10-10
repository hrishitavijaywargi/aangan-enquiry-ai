/**
 * `npx tsx scripts/vaani-smoke-test.ts [ws-url]` — imitates Vaani against the BYOL server:
 * rejects a bad token, then plays a short call and prints the replies.
 */
import fs from "node:fs";
import WebSocket from "ws";

const token = fs.readFileSync(".env.local", "utf8").match(/^VAANI_BYOL_TOKEN=(.*)$/m)?.[1]?.trim() ?? "";
const base = process.argv[2] ?? "ws://localhost:8090/chat/stream";
const WELCOME = "Thank you for calling Aangan Studio. You're speaking with the studio's virtual assistant. How can I help you today?";
const lines = [
  "Hi, I'm Kavya. We have a 2BHK in Wakad, about 950 square feet, and want a full redesign with execution.",
  "How much would that cost per square foot?",
  "We'd like it done by March.",
];

function connect(auth: string) {
  return new WebSocket(`${base}/smoke-${Date.now()}`, { headers: auth ? { Authorization: `Bearer ${auth}` } : {} });
}

async function main() {
  // 1) Wrong token must be rejected.
  await new Promise<void>((resolve) => {
    const bad = connect("wrong-token");
    bad.on("unexpected-response", (_req, res) => { console.log(`bad token → HTTP ${res.statusCode} (rejected ✓)`); resolve(); });
    bad.on("open", () => { console.log("bad token → ACCEPTED ✗"); bad.close(); resolve(); });
    bad.on("error", () => {});
  });

  // 2) Real conversation.
  const ws = connect(token);
  const transcript: { role: string; content: string }[] = [{ role: "system", content: "ignored" }, { role: "assistant", content: WELCOME }];
  let id = 0;
  let handshake = 0;
  const sendNext = () => {
    const line = lines[id];
    if (!line) { ws.close(); return; }
    transcript.push({ role: "user", content: line });
    ws.send(JSON.stringify({ interaction_type: "response_required", response_id: ++id, call_id: "smoke", transcript, req_body: { contact_number: "+919000088888" } }));
    console.log(`CALLER: ${line}`);
  };
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.interaction_type) { if (++handshake === 2) { console.log("handshake frames received ✓"); sendNext(); } return; }
    console.log(`AGENT #${m.response_id}: ${m.content}${m.end_call ? " [end_call]" : ""}`);
    transcript.push({ role: "assistant", content: m.content });
    sendNext();
  });
  ws.on("close", () => console.log("closed"));
  ws.on("error", (e) => console.error("error:", e.message));
}
main();
