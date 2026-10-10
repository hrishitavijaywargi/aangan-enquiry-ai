"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CostChart, OutcomesChart, ResponseChart, VolumeChart } from "@/components/Charts";
import { Card, Metric, PageHeader } from "@/components/ui";
import { inr, pct, secs } from "@/lib/format";
import type { DashboardMetrics } from "@/lib/metrics";

const STATUSES = [
  ["all", "All statuses"],
  ["qualified", "Qualified"],
  ["not_qualified", "Not Qualified"],
  ["awaiting_info", "Awaiting Information"],
  ["escalated", "Escalated"],
];
const TYPES = [
  ["all", "All types"],
  ["residential", "Residential"],
  ["commercial", "Commercial"],
  ["complaint", "Existing-client complaint"],
  ["unknown", "Unknown"],
];

export default function Dashboard({ initial }: { initial: DashboardMetrics }) {
  const [m, setM] = useState(initial);
  const [f, setF] = useState({ from: "", to: "", status: "all", type: "all" });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v && v !== "all"));
    setLoading(true);
    fetch(`/api/metrics?${q}`)
      .then((r) => r.json())
      .then((d) => !d.error && setM(d))
      .finally(() => setLoading(false));
  }, [f]);

  const demo = m.demoCount > 0;
  const dataTag = demo ? (["demo"] as const) : (["recorded"] as const);
  const sel = "rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-sm text-stone-800";

  return (
    <div>
      <PageHeader
        title="Founder dashboard"
        description="Every number below is calculated from stored call records. Estimates and unavailable data are labelled — nothing is hardcoded."
        actions={
          <Link href="/calls" className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
            + New simulated call
          </Link>
        }
      />

      {/* Filters — one row above the charts */}
      <div className="mb-5 flex flex-wrap items-end gap-2 rounded-xl border border-stone-200 bg-white p-3">
        <label className="text-xs text-stone-500">
          From
          <input type="date" className={`${sel} mt-1 block`} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        </label>
        <label className="text-xs text-stone-500">
          To
          <input type="date" className={`${sel} mt-1 block`} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        </label>
        <label className="text-xs text-stone-500">
          Status
          <select className={`${sel} mt-1 block`} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="text-xs text-stone-500">
          Enquiry type
          <select className={`${sel} mt-1 block`} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
            {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <button className="rounded-lg px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-100" onClick={() => setF({ from: "", to: "", status: "all", type: "all" })}>
          Clear
        </button>
        <span className="ml-auto text-xs text-stone-400">{loading ? "Updating…" : `${m.total} enquiries · ${m.calls} calls`}</span>
      </div>

      {/* Volume & outcomes */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Metric label="Total enquiries" value={m.total} hint={`${m.calls} calls · ${m.repeatCallsMerged} repeat calls merged`} tags={[...dataTag]} />
        <Metric label="Qualified" value={m.qualified} hint={m.total ? `${pct((m.qualified / m.total) * 100)} of enquiries` : undefined} tags={[...dataTag]} />
        <Metric label="Declined / not qualified" value={m.notQualified} tags={[...dataTag]} />
        <Metric label="Awaiting information" value={m.awaiting} tags={[...dataTag]} />
        <Metric label="Escalated to a human" value={m.escalated} hint={`${m.urgent} flagged urgent`} tags={[...dataTag]} />
        <Metric label="After-hours enquiries" value={m.afterHours} hint={m.total ? `${pct((m.afterHours / m.total) * 100)} — answered, not missed` : undefined} tags={[...dataTag]} />
      </div>

      {/* Speed & conversion */}
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Metric label="Avg. time to answer" value={secs(m.avgResponseSeconds)} hint="Ring → AI answers (measured)" tags={[...dataTag]} />
        <Metric label="Answered within 5 min" value={pct(m.pctWithin5Min)} hint={`Target: 100% · ${m.answeredCount} answered`} tags={[...dataTag]} />
        <Metric label="Consultations requested" value={m.consultationsRequested} hint="Caller said yes to booking on the call" tags={[...dataTag]} />
        <Metric
          label="Consultations completed"
          value={m.consultationsCompleted ?? "Unavailable"}
          hint={m.consultationsCompleted === null ? "Not recorded yet — set on each enquiry" : undefined}
          tags={m.consultationsCompleted === null ? ["unavailable"] : ["recorded"]}
        />
        <Metric
          label="Projects won"
          value={m.projectsWon ?? "Unavailable"}
          hint={m.projectsWon === null ? "No conversion data recorded — not assumed" : `${m.outcomesRecorded} outcomes recorded`}
          tags={m.projectsWon === null ? ["unavailable"] : ["recorded"]}
        />
        <Metric label="Revenue" value="Unavailable" hint="Not tracked by this system" tags={["unavailable"]} />
      </div>

      {/* Cost */}
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Metric label="AI usage cost" value={inr(m.costs.aiInr, 2)} hint={m.costs.tokensAreEstimates ? "Projected tokens — mock AI, no API calls" : `${m.costs.liveAiCalls} live API calls`} tags={["estimate"]} />
        <Metric label="Telephony" value={inr(m.costs.telephonyInr)} hint={`${m.costs.billedMinutes} billed min × configured rate`} tags={["estimate"]} />
        <Metric label="Recurring (pro-rated)" value={inr(m.costs.recurringProratedInr)} hint={`${inr(m.costs.recurringMonthlyInr)}/month × ${m.costs.periodDays} days`} tags={["estimate"]} />
        <Metric label="Total operating cost" value={inr(m.costs.totalInr)} hint="For the filtered period" tags={["estimate"]} />
        <Metric label="Cost per enquiry" value={inr(m.costPerEnquiry, 2)} tags={["estimate"]} />
        <Metric label="Cost per qualified enquiry" value={m.costPerQualified === null ? "Unavailable" : inr(m.costPerQualified, 2)} hint={`Projected monthly: ${inr(m.projectedMonthlyInr)}`} tags={["estimate"]} />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card title="Enquiry volume over time" subtitle="New enquiries per day (IST), by outcome. Repeat calls are not double-counted.">
          <VolumeChart data={m.series} />
        </Card>
        <Card title="Enquiry outcomes" subtitle="Current status of each enquiry">
          <OutcomesChart
            data={[
              { status: "qualified", count: m.qualified },
              { status: "not_qualified", count: m.notQualified },
              { status: "awaiting_info", count: m.awaiting },
              { status: "escalated", count: m.escalated },
            ]}
          />
        </Card>
        <Card title="Response times" subtitle="Time from ring to answer, first call of each enquiry. Five-minute target.">
          <ResponseChart data={m.responseBuckets} />
        </Card>
        <Card title="Variable costs per day" subtitle="Estimated: configured rates × recorded usage. Recurring costs shown in the cards above." right={<Link href="/costs" className="text-xs font-medium text-brand-700 hover:underline">Cost analytics →</Link>}>
          <CostChart data={m.costSeries} />
        </Card>
      </div>

      <p className="mt-6 text-xs text-stone-500">
        Case baseline for comparison (reported by Nikhil for all channels, not measured by this system): ~48% of enquiries got no response within 48 hours; ~33% arrive outside 10am–7pm.
      </p>
    </div>
  );
}
