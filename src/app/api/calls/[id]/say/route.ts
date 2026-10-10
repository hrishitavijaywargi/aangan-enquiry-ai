import { handler } from "@/lib/api";
import { callerSays } from "@/lib/service";

export const POST = handler(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { text } = (await req.json()) as { text?: string };
  return callerSays((await params).id, String(text ?? ""));
});
