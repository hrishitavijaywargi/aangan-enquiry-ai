import { handler } from "@/lib/api";
import { answerCall } from "@/lib/service";

export const POST = handler(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => answerCall((await params).id));
