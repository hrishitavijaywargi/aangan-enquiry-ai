import { handler } from "@/lib/api";
import { deliverHandoff } from "@/lib/service";

/** Sends via SMTP when configured; otherwise saves an .eml locally and says so. Never fakes "sent". */
export const POST = handler(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => deliverHandoff((await params).id));
