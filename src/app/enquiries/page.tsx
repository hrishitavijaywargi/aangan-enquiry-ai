import Link from "next/link";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { loadAll } from "@/lib/data";
import { TYPE_LABEL, displayName, istDateTime, secs } from "@/lib/format";
import { applyFilters } from "@/lib/metrics";
import { ready } from "@/lib/ready";
import type { EnquiryFields } from "@/lib/types";

export const dynamic = "force-dynamic";

type SP = Promise<{ status?: string; type?: string; from?: string; to?: string; q?: string }>;

export default async function EnquiriesPage({ searchParams }: { searchParams: SP }) {
  await ready();
  const sp = await searchParams;
  const all = loadAll().enquiries;
  const q = (sp.q ?? "").toLowerCase().trim();
  const rows = applyFilters(all, sp).filter((e) => !q || `${e.ref} ${e.caller_name ?? ""} ${e.fields}`.toLowerCase().includes(q));
  const sel = "rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-sm";

  return (
    <div>
      <PageHeader
        title="Enquiries"
        description="One row per enquiry — repeat calls from the same number are merged, not double-counted."
        actions={<Link href="/calls" className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">+ New simulated call</Link>}
      />
      <form className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-stone-200 bg-white p-3">
        <input name="q" defaultValue={sp.q} placeholder="Search name, ref, area…" className={`${sel} min-w-[180px] flex-1`} />
        <select name="status" defaultValue={sp.status ?? "all"} className={sel} aria-label="Status">
          <option value="all">All statuses</option>
          <option value="qualified">Qualified</option>
          <option value="not_qualified">Not Qualified</option>
          <option value="awaiting_info">Awaiting Information</option>
          <option value="escalated">Escalated</option>
          <option value="in_progress">In Progress</option>
        </select>
        <select name="type" defaultValue={sp.type ?? "all"} className={sel} aria-label="Enquiry type">
          <option value="all">All types</option>
          <option value="residential">Residential</option>
          <option value="commercial">Commercial</option>
          <option value="complaint">Complaint</option>
          <option value="unknown">Unknown</option>
        </select>
        <input type="date" name="from" defaultValue={sp.from} className={sel} aria-label="From date" />
        <input type="date" name="to" defaultValue={sp.to} className={sel} aria-label="To date" />
        <button className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-medium text-white">Filter</button>
        <Link href="/enquiries" className="px-2 py-1.5 text-sm text-stone-500 hover:text-stone-800">Clear</Link>
      </form>
      <Card title={`${rows.length} enquiries`}>
        <div className="-m-4 overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-4 py-2.5">Ref</th>
                <th className="px-4 py-2.5">Received (IST)</th>
                <th className="px-4 py-2.5">Caller</th>
                <th className="px-4 py-2.5">Project</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Answered in</th>
                <th className="px-4 py-2.5">Calls</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((e) => {
                const f = JSON.parse(e.fields) as EnquiryFields;
                return (
                  <tr key={e.id} className="hover:bg-stone-50">
                    <td className="px-4 py-2.5 font-medium">
                      <Link href={`/enquiries/${e.id}`} className="text-brand-700 hover:underline">{e.ref}</Link>
                      {e.is_demo ? <span className="ml-1.5 rounded bg-amber-50 px-1 text-[10px] font-semibold text-amber-800">DEMO</span> : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-stone-600">
                      {istDateTime(e.created_at)}
                      {e.after_hours ? <span className="ml-1 text-xs text-amber-700">· after hours</span> : null}
                    </td>
                    <td className="px-4 py-2.5">
                      {displayName(e.caller_name)}
                      <div className="text-xs text-stone-400">{e.phone_masked}</div>
                    </td>
                    <td className="px-4 py-2.5 text-stone-700">
                      {TYPE_LABEL[e.enquiry_type]}
                      <div className="text-xs text-stone-500">{[f.propertyType ?? f.outOfScopeType, f.location].filter(Boolean).join(" · ")}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={e.status} />
                      {e.urgent ? <span className="ml-1 text-xs font-semibold text-red-700">URGENT</span> : null}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">{secs(e.first_response_seconds)}</td>
                    <td className="px-4 py-2.5 tabular-nums">{e.call_count}</td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-stone-400">No enquiries match these filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
