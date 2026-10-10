import { handler } from "@/lib/api";
import { dashboard } from "@/lib/data";
import { resetDemoData } from "@/lib/seed/seed";

export const POST = handler(async () => {
  await resetDemoData();
  const m = await dashboard({});
  return { ok: true, enquiries: m.total, calls: m.calls };
});
