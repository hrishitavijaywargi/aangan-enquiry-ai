/**
 * Twilio Programmable Voice webhook (future live mode — NOT used in the demo).
 * Point the Twilio number's "A call comes in" webhook to  POST {PUBLIC_BASE_URL}/api/telephony/twilio/voice
 * Enabled only when TELEPHONY_PROVIDER=twilio and TWILIO_AUTH_TOKEN are set. Every request's
 * X-Twilio-Signature is verified. Speech is transcribed by Twilio <Gather input="speech">.
 * Untested against a live Twilio account in this build — see BUILD_AND_DEMO.md → Limitations.
 */
import { ready } from "@/lib/ready";
import { answerCall, callerSays, endCall, getCall, startCall } from "@/lib/service";
import { telephonyStatus, twimlSayAndGather, validTwilioSignature } from "@/lib/telephony";

const xml = (body: string, status = 200) => new Response(body, { status, headers: { "Content-Type": "text/xml" } });

export async function POST(req: Request) {
  const t = telephonyStatus();
  if (t.provider !== "twilio" || !t.live) return new Response("Twilio telephony is not enabled", { status: 404 });
  await ready();

  const form = await req.formData();
  const params: Record<string, string> = {};
  form.forEach((v, k) => (params[k] = String(v)));
  const url = new URL(req.url);
  const publicUrl = (process.env.PUBLIC_BASE_URL ?? url.origin) + url.pathname + url.search;
  if (!validTwilioSignature(process.env.TWILIO_AUTH_TOKEN!, publicUrl, params, req.headers.get("x-twilio-signature"))) {
    return new Response("Invalid signature", { status: 403 });
  }

  const base = (process.env.PUBLIC_BASE_URL ?? url.origin) + url.pathname;
  const callId = url.searchParams.get("callId");

  // Status callback / caller hung up
  if (callId && params.CallStatus && ["completed", "busy", "failed", "no-answer", "canceled"].includes(params.CallStatus)) {
    if (getCall(callId)) await endCall(callId, "caller_hung_up");
    return xml("<Response/>");
  }

  // New inbound call → ring + answer immediately
  if (!callId) {
    const s = startCall({ phone: params.From ?? "", provider: "twilio", isDemo: false });
    const a = answerCall(s.callId);
    return xml(twimlSayAndGather(a.reply, `${base}?callId=${s.callId}`));
  }

  const speech = (params.SpeechResult ?? "").trim();
  if (!speech) return xml(twimlSayAndGather("Sorry, I didn't catch that — could you say that again?", `${base}?callId=${callId}`));
  const r = await callerSays(callId, speech);
  if (r.ended) {
    await endCall(callId, "completed");
    return xml(twimlSayAndGather(r.reply, base, true));
  }
  return xml(twimlSayAndGather(r.reply, `${base}?callId=${callId}`));
}
