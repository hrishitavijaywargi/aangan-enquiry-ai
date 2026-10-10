import { handler } from "@/lib/api";
import { clearForLive } from "@/lib/seed/seed";

export const POST = handler(async () => {
  await clearForLive();
  return { ok: true };
});
