import { handler } from "@/lib/api";
import { createHandoff, enquiryDetail, updateOutcome } from "@/lib/service";

export const GET = handler(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const d = await enquiryDetail((await params).id);
  if (!d) throw new Error("Enquiry not found");
  return d;
});

/** Record what happened after the call (consultation / project outcome) — the only source of conversion data. */
export const PATCH = handler(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const body = (await req.json()) as { consultation_status?: string; project_outcome?: string; regenerateHandoff?: boolean };
  const id = (await params).id;
  if (body.regenerateHandoff) return createHandoff(id, { forceSend: false });
  return updateOutcome(id, body);
});
