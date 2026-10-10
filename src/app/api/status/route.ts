import { handler } from "@/lib/api";
import { systemStatus } from "@/lib/status";

export const dynamic = "force-dynamic";
export const GET = handler(async () => systemStatus());
