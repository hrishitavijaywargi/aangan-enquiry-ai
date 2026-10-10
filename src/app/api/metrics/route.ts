import { handler } from "@/lib/api";
import { dashboard } from "@/lib/data";

export const dynamic = "force-dynamic";
export const GET = handler(async (req: Request) => {
  const p = new URL(req.url).searchParams;
  return dashboard({ from: p.get("from") || undefined, to: p.get("to") || undefined, status: p.get("status") || undefined, type: p.get("type") || undefined });
});
