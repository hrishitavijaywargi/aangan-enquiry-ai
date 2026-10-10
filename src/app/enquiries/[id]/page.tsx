import Link from "next/link";
import { notFound } from "next/navigation";
import { OutcomeEditor, SendHandoffButton } from "@/components/EnquiryActions";
import { FieldsTable, QualificationPanel } from "@/components/EnquiryPanels";
import { Card, PageHeader, StatusBadge, Tag } from "@/components/ui";
import { outstandingItems } from "@/lib/agent";
import { HANDOFF_STATUS, TYPE_LABEL, istDateTime, secs } from "@/lib/format";
import { ready } from "@/lib/ready";
import { enquiryDetail } from "@/lib/service";

export const dynamic = "force-dynamic";

export default async function EnquiryPage({ params }: { params: Promise<{ id: string }> }) {
  await ready();
  const d = enquiryDetail((await params).id);
  if (!d) notFound();
  const { enquiry: e, fields, qualification: q, messages, calls, handoffs, usage } = d;
  const outstanding = q && q.decision !== "not_applicable" ? outstandingItems(fields, q) : [];
  const tokensIn = usage.reduce((a, u) => a + u.input_tokens, 0);
  const tokensOut = usage.reduce((a, u) => a + u.output_tokens, 0);
  const estimated = usage.every((u) => u.is_estimate);

  return (
    <div>
      <PageHeader
        title={`${e.ref} · ${fields.callerName ?? "Unknown caller"}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={e.status} />
            {e.urgent ? <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">URGENT — human attention</span> : null}
            <span>{TYPE_LABEL[e.enquiry_type]}</span>·<span>{istDateTime(e.created_at)} IST</span>
            {e.after_hours ? <span className="text-amber-700">· after hours</span> : null}
            <span>· {e.phone_masked}</span>
            {e.is_demo ? <Tag kind="demo" /> : null}
          </span>
        }
        actions={<Link href="/enquiries" className="rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-700 hover:bg-stone-50">← All enquiries</Link>}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <Card title="Call summary" subtitle={e.summary_source === "llm" ? "Written by the AI model from the transcript" : "Generated from the structured record (mock AI mode)"}>
            <p className="text-sm leading-relaxed text-stone-800">{e.summary ?? "Call in progress."}</p>
          </Card>

          <Card title="Transcript" subtitle={`${calls.length} call${calls.length > 1 ? "s" : ""} — all merged into this enquiry`}>
            <div className="space-y-4">
              {calls.map((c, idx) => (
                <div key={c.id}>
                  <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600">
                    <b>Call {idx + 1}</b>
                    <span>Rang {istDateTime(c.ring_at)}</span>
                    <span>Answered in {secs(c.response_seconds)}</span>
                    <span>Duration {secs(c.duration_seconds)}</span>
                    <span>{c.status}{c.end_reason && c.end_reason !== "completed" ? ` (${c.end_reason.replace(/_/g, " ")})` : ""}</span>
                    <span>{c.provider === "demo" ? "Simulated call" : c.provider}</span>
                  </div>
                  <div className="space-y-2">
                    {messages
                      .filter((m) => m.call_id === c.id)
                      .map((m) => {
                        const tags = JSON.parse(m.tags) as string[];
                        if (m.role === "system") return <div key={m.id} className="text-center text-xs italic text-stone-500">{m.text}</div>;
                        return (
                          <div key={m.id} className={`flex ${m.role === "caller" ? "justify-end" : ""}`}>
                            <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm ${m.role === "caller" ? "rounded-br-sm bg-brand-600 text-white" : "rounded-bl-sm border border-stone-200 bg-white"}`}>
                              <div className={`text-[10px] font-semibold uppercase ${m.role === "caller" ? "text-brand-100" : "text-stone-400"}`}>{m.role === "caller" ? "Caller" : "AI assistant"}</div>
                              {m.text}
                              {tags.filter((t) => t !== "after_hours").length > 0 && (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {tags.map((t) => <span key={t} className="rounded bg-stone-100 px-1.5 text-[10px] text-stone-600">{t.replace(/_/g, " ")}</span>)}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Qualification & evidence">
            <QualificationPanel q={q} />
          </Card>
          <Card title="Structured enquiry record">
            <FieldsTable fields={fields} />
          </Card>
          {outstanding.length > 0 && (
            <Card title="Outstanding questions / uncertainties">
              <ul className="list-disc space-y-1 pl-4 text-sm text-stone-700">{outstanding.map((o) => <li key={o}>{o}</li>)}</ul>
            </Card>
          )}
          <Card title="Email handoff">
            {handoffs.length === 0 ? (
              <p className="text-sm text-stone-500">No handoff — only qualified leads and escalations are emailed.</p>
            ) : (
              <div className="space-y-3">
                {handoffs.map((h) => (
                  <div key={h.id} className="space-y-1.5 text-sm">
                    <div className="font-medium">{h.subject}</div>
                    <div className="text-xs text-stone-500">To {h.to_address} · <b>{HANDOFF_STATUS[h.status] ?? h.status}</b>{h.sent_at ? ` at ${istDateTime(h.sent_at)}` : ""}</div>
                    {h.error && <div className="text-xs text-amber-800">{h.error}</div>}
                    <div className="flex gap-2">
                      <Link href={`/handoffs?id=${h.id}`} className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-50">Preview</Link>
                      <SendHandoffButton id={h.id} status={h.status} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card title="After the call" subtitle="Record real outcomes here. Until you do, conversion shows as 'Unavailable' — nothing is assumed.">
            <OutcomeEditor id={e.id} consultation={e.consultation_status} project={e.project_outcome} />
          </Card>
          <Card title="AI usage for this enquiry">
            <div className="flex items-center justify-between text-sm">
              <span>{usage.length} requests · {tokensIn.toLocaleString()} in / {tokensOut.toLocaleString()} out tokens</span>
              <Tag kind={estimated ? "estimate" : "recorded"} />
            </div>
            {estimated && <p className="mt-1 text-xs text-stone-500">Mock AI: token counts are projected from text length — no API call was made.</p>}
          </Card>
        </div>
      </div>
    </div>
  );
}
