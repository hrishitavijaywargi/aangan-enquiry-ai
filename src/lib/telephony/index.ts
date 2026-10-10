/**
 * Telephony adapter boundary. The call workflow (service.ts) is provider-agnostic:
 *   ring → answer → caller utterance(s) → end
 * The demo provider drives it from the browser simulator. A real provider (e.g. Twilio)
 * drives the same four steps from its webhooks — see src/app/api/telephony/twilio/voice/route.ts.
 */
import crypto from "node:crypto";

export type TelephonyProviderName = "demo" | "twilio" | "vaani";

export interface TelephonyStatus {
  provider: TelephonyProviderName;
  live: boolean;
  message: string;
}

export function telephonyStatus(): TelephonyStatus {
  const p = (process.env.TELEPHONY_PROVIDER ?? "demo").toLowerCase();
  if (p === "vaani") {
    if (!process.env.VAANI_BYOL_TOKEN) {
      return { provider: "vaani", live: false, message: "TELEPHONY_PROVIDER=vaani but VAANI_BYOL_TOKEN is missing — the BYOL server will refuse to start. Simulated calls still work." };
    }
    return { provider: "vaani", live: true, message: "Vaani Voice (BYOL): real calls are answered by Vaani; every reply is decided by this app's rules engine (run `npm run vaani`). Simulated calls still work." };
  }
  if (p === "twilio") {
    if (!process.env.TWILIO_AUTH_TOKEN) {
      return { provider: "twilio", live: false, message: "TELEPHONY_PROVIDER=twilio but TWILIO_AUTH_TOKEN is missing — webhook disabled. Running simulated calls only." };
    }
    return { provider: "twilio", live: true, message: "Twilio webhook enabled at /api/telephony/twilio/voice (speech-to-text via Twilio <Gather>)." };
  }
  return { provider: "demo", live: false, message: "Demo mode — calls are simulated in the browser. No real phone calls are answered." };
}

/**
 * Twilio request signature check (X-Twilio-Signature): base64(HMAC-SHA1(authToken, url + sorted params)).
 */
export function validTwilioSignature(authToken: string, url: string, params: Record<string, string>, signature: string | null): boolean {
  if (!signature) return false;
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  const expected = crypto.createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Minimal TwiML builder for a speech <Gather> turn. */
export function twimlSayAndGather(say: string, actionUrl: string, end = false): string {
  const x = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  if (end) return `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Aditi">${x(say)}</Say><Hangup/></Response>`;
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Gather input="speech" language="en-IN" speechTimeout="auto" action="${x(actionUrl)}" method="POST"><Say voice="Polly.Aditi">${x(say)}</Say></Gather><Redirect method="POST">${x(actionUrl)}&amp;silence=1</Redirect></Response>`;
}
