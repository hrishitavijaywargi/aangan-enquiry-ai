/**
 * Vaani Voice BYOL WebSocket server — `npm run vaani`
 *
 * Paste the public wss URL of this server into Vaani: Agent → Brain → Reasoning Language Model →
 * "Bring your Own LLM (BYOL)", with the same Auth Token as VAANI_BYOL_TOKEN in .env.local.
 * Vaani connects to  <url>/<call_id>  once per call. Shares the app's SQLite database, so calls
 * appear on the dashboard (run `npm run dev` alongside it).
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";

// Load .env.local / .env (Next.js does this for the web app; this script runs standalone).
for (const file of [".env.local", ".env"]) {
  const p = path.join(process.cwd(), file);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const PORT = Number(process.env.VAANI_BYOL_PORT || 8090);
const TOKEN = process.env.VAANI_BYOL_TOKEN || "";
const ALLOW_NO_AUTH = process.env.VAANI_BYOL_ALLOW_NO_AUTH === "true";

async function main() {
  if (!TOKEN && !ALLOW_NO_AUTH) {
    console.error("VAANI_BYOL_TOKEN is not set. Add a long random token to .env.local (and the same token in Vaani's BYOL Auth Token field).");
    process.exit(1);
  }
  const { ready } = await import("../src/lib/ready");
  const { ByolSession, HANDSHAKE_FRAMES } = await import("../src/lib/telephony/vaaniByol");
  await ready();

  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "aangan-vaani-byol" }));
      return;
    }
    res.writeHead(404).end();
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const auth = req.headers.authorization ?? "";
    if (!ALLOW_NO_AUTH && auth !== `Bearer ${TOKEN}`) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      console.warn(`[vaani] rejected connection to ${req.url} — bad or missing token`);
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (ws: WebSocket, req: http.IncomingMessage) => {
    const vaaniCallId = decodeURIComponent((req.url ?? "").split("/").filter(Boolean).pop() ?? "unknown");
    const session = new ByolSession(vaaniCallId);
    console.log(`[vaani] call connected: ${vaaniCallId}`);
    for (const f of HANDSHAKE_FRAMES) ws.send(JSON.stringify(f));

    let queue = Promise.resolve();
    ws.on("message", (raw) => {
      queue = queue.then(async () => {
        let msg;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (msg.response_type === "ping_pong") return;
        const reply = await session.handle(msg);
        if (reply) {
          ws.send(JSON.stringify(reply));
          console.log(`[vaani] ${vaaniCallId} #${reply.response_id}: ${reply.content.slice(0, 90)}${reply.end_call ? " [end_call]" : ""}`);
        }
      });
    });
    ws.on("close", () => {
      queue.then(() => session.close()).then(() => console.log(`[vaani] call closed: ${vaaniCallId}`));
    });
  });

  server.listen(PORT, () => {
    console.log(`Aangan BYOL server listening on ws://localhost:${PORT}  (health: http://localhost:${PORT}/health)`);
    console.log(ALLOW_NO_AUTH ? "WARNING: authentication disabled" : "Bearer-token authentication: on");
  });
}

main();
