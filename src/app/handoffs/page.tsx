import Link from "next/link";
import { SendHandoffButton } from "@/components/EnquiryActions";
import { Card, PageHeader } from "@/components/ui";
import { listHandoffs } from "@/lib/data";
import { emailConfigProblem } from "@/lib/email/mailer";
import { HANDOFF_STATUS, displayName, istDateTime } from "@/lib/format";
import { ready } from "@/lib/ready";

export const dynamic = "force-dynamic";

export default async function HandoffsPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  await ready();
  const { id } = await searchParams;
  const all = await listHandoffs();
  const selected = all.find((h) => h.id === id) ?? all[0];
  const problem = emailConfigProblem();

  return (
    <div>
      <PageHeader
        title="Handoffs"
        description="Qualified leads go to designers, complaints go to the studio head — by email, so there is a complete, readable record the team can act on and forward."
      />
      <div className={`mb-4 rounded-xl border p-3 text-sm ${problem ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}>
        {problem ? (
          <>
            <b>Local demo mode:</b> {problem} Each email is written to <code>data/outbox/*.eml</code> (open it in any mail client). Configure SMTP in <code>.env.local</code> to send for real.
          </>
        ) : (
          <>
            <b>SMTP configured.</b> “Send email” delivers for real; status changes to Sent only after the mail server accepts it.
          </>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
        <Card title={`${all.length} handoff notes`}>
          <ul className="-m-4 divide-y divide-stone-100">
            {all.map((h) => (
              <li key={h.id}>
                <Link href={`/handoffs?id=${h.id}`} className={`block px-4 py-3 hover:bg-stone-50 ${selected?.id === h.id ? "bg-brand-50" : ""}`}>
                  <div className="flex items-center gap-2 text-xs">
                    <span className={`rounded px-1.5 py-0.5 font-semibold ${h.kind === "escalation" ? "bg-red-100 text-red-800" : "bg-green-100 text-green-800"}`}>{h.kind === "escalation" ? "ESCALATION" : "QUALIFIED LEAD"}</span>
                    {h.urgent ? <span className="font-semibold text-red-700">urgent</span> : null}
                    <span className="ml-auto text-stone-400">{h.ref}</span>
                  </div>
                  <div className="mt-1 text-sm font-medium text-stone-900">{displayName(h.caller_name)}</div>
                  <div className="text-xs text-stone-500">
                    {HANDOFF_STATUS[h.status] ?? h.status} · {istDateTime(h.created_at)}
                  </div>
                </Link>
              </li>
            ))}
            {!all.length && <li className="px-4 py-8 text-center text-sm text-stone-400">No handoffs yet.</li>}
          </ul>
        </Card>

        {selected && (
          <Card
            title={selected.subject}
            subtitle={
              <>
                To: {selected.to_address} · <b>{HANDOFF_STATUS[selected.status] ?? selected.status}</b>
                {selected.eml_path ? (
                  <>
                    {" "}· saved as <code className="break-all">{selected.eml_path}</code>
                  </>
                ) : null}
              </>
            }
            right={<SendHandoffButton id={selected.id} status={selected.status} />}
          >
            {selected.error && <p className="mb-3 rounded bg-amber-50 p-2 text-xs text-amber-900">{selected.error}</p>}
            <iframe title="Email preview" srcDoc={selected.body_html} className="h-[640px] w-full rounded-lg border border-stone-200 bg-white" sandbox="" />
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-stone-600">Plain-text version</summary>
              <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-stone-50 p-3 text-xs text-stone-700">{selected.body_text}</pre>
            </details>
            <Link href={`/enquiries/${selected.enquiry_id}`} className="mt-3 inline-block text-sm font-medium text-brand-700 hover:underline">
              Open enquiry →
            </Link>
          </Card>
        )}
      </div>
    </div>
  );
}
