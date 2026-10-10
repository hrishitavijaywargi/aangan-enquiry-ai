import { handler } from "@/lib/api";
import { enquiryDetail, endCall, getCall } from "@/lib/service";

export const POST = handler(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const id = (await params).id;
  const { reason } = (await req.json().catch(() => ({}))) as { reason?: "completed" | "caller_hung_up" | "dropped" };
  const e = await endCall(id, reason ?? "completed");
  const d = (await enquiryDetail(e.id))!;
  return { enquiry: d.enquiry, qualification: d.qualification, handoffs: d.handoffs.map((h) => ({ id: h.id, kind: h.kind, status: h.status, subject: h.subject, error: h.error })), call: await getCall(id) };
});
