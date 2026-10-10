import { handler } from "@/lib/api";
import { clearForLive } from "@/lib/seed/seed";

export const POST = handler(async () => {
  clearForLive();
  return { ok: true };
});
