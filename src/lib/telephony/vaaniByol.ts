/**
 * Vaani Voice "Bring Your Own LLM" (BYOL) adapter — https://docs.vaanivoice.ai/guides/byol
 *
 * Vaani owns the phone line, speech-to-text and text-to-speech. For every caller turn it sends the
 * conversation to us over a WebSocket; we run the SAME workflow as the simulator (service.ts) and
 * send back the exact text to speak. Our deterministic engine therefore still decides every reply:
 * the five criteria, the verbatim pricing script, escalations. Vaani's own system prompt is ignored.
 *
 * This file holds the protocol logic only (no sockets), so it can be unit-tested.
 */
import { answerCall, callerSays, endCall, getCall, startCall } from "../service";

export interface ByolTranscriptEntry {
  role: "system" | "assistant" | "user";
  content: string;
}

export interface ByolRequest {
  interaction_type: string;
  response_id: number;
  call_id?: string;
  transcript?: ByolTranscriptEntry[];
  req_body?: { contact_number?: string; name?: string } | null;
}

export interface ByolResponse {
  response_type: "response";
  response_id: number;
  content: string;
  content_complete: true;
  end_call?: boolean;
}

/** Frames we must send immediately after the WebSocket is accepted (per the BYOL protocol). */
export const HANDSHAKE_FRAMES = [
  { interaction_type: "config", content: "Server ready" },
  { interaction_type: "greeting", content: "Hello" },
];

const SAFE_RETRY = "Sorry, I didn't quite catch that — could you say that again?";

export class ByolSession {
  private callId: string | null = null;
  private usersProcessed = 0;
  private ended = false;

  constructor(private readonly vaaniCallId: string) {}

  /** Our internal call id (null until the first turn arrives). */
  get internalCallId() {
    return this.callId;
  }

  /** Handle one BYOL frame. Returns the frame to send back, or null if no reply is needed. */
  async handle(msg: ByolRequest): Promise<ByolResponse | null> {
    if (msg.interaction_type !== "response_required") return null;
    const id = msg.response_id;
    const transcript = msg.transcript ?? [];

    if (this.ended) return { response_type: "response", response_id: id, content: "Thank you for calling Aangan Studio. Goodbye!", content_complete: true, end_call: true };

    // First turn: register the call. Vaani has already spoken its welcome message — record that exact text.
    if (!this.callId) {
      const welcome = transcript.find((t) => t.role === "assistant")?.content;
      const s = await startCall({ phone: msg.req_body?.contact_number || undefined, provider: "vaani", isDemo: false });
      this.callId = s.callId;
      await answerCall(s.callId, { greetingOverride: welcome });
    }

    // New caller speech since the last turn (Vaani re-sends the full transcript each time; it can repeat lines).
    const users = transcript.filter((t) => t.role === "user").map((t) => t.content.trim()).filter(Boolean);
    const fresh = users.slice(this.usersProcessed).filter((u, i, a) => i === 0 || u !== a[i - 1]);
    this.usersProcessed = users.length;
    const text = fresh.join(" ").trim();
    if (!text) return { response_type: "response", response_id: id, content: SAFE_RETRY, content_complete: true };

    try {
      const r = await callerSays(this.callId, text);
      if (r.ended) {
        this.ended = true;
        await endCall(this.callId, "completed");
      }
      return { response_type: "response", response_id: id, content: r.reply, content_complete: true, ...(r.ended ? { end_call: true } : {}) };
    } catch (e) {
      console.error(`[vaani ${this.vaaniCallId}] turn failed:`, (e as Error).message);
      return { response_type: "response", response_id: id, content: SAFE_RETRY, content_complete: true };
    }
  }

  /** WebSocket closed — if the caller hung up mid-conversation, close the call properly. */
  async close() {
    if (!this.callId || this.ended) return;
    const c = await getCall(this.callId);
    if (c && c.status === "in_progress") await endCall(this.callId, "caller_hung_up");
    this.ended = true;
  }
}
