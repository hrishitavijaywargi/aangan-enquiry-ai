import { handler } from "@/lib/api";
import { scenarioByKey } from "@/lib/seed/scenarios";
import { startCall } from "@/lib/service";

/** A simulated call starts ringing. The browser then calls /answer after the ring delay. */
export const POST = handler(async (req: Request) => {
  const body = (await req.json().catch(() => ({}))) as { scenarioKey?: string; phone?: string };
  const sc = body.scenarioKey ? scenarioByKey(body.scenarioKey) : undefined;
  if (body.scenarioKey && !sc) throw new Error("Unknown scenario");
  // Scenario replays get a fresh demo caller ID so they are not merged into the seeded enquiry.
  const phone = body.phone?.trim() || undefined;
  if (body.phone && body.phone.replace(/\D/g, "").length < 6) throw new Error("Enter a phone number with at least 6 digits, or leave it blank for a random demo number");
  return startCall({ phone, scenarioKey: sc?.key, provider: "demo", isDemo: true });
});
