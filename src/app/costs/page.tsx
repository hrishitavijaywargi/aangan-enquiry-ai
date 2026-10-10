import Link from "next/link";
import { CostChart } from "@/components/Charts";
import { Card, Metric, PageHeader, Tag } from "@/components/ui";
import { aiStatus } from "@/lib/ai/provider";
import { callCostRows, dashboard } from "@/lib/data";
import { displayName, inr, istDateTime, secs } from "@/lib/format";
import { aiCostUsd, billedMinutes } from "@/lib/metrics";
import { ready } from "@/lib/ready";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function CostsPage() {
  await ready();
  const [s, m, rows] = await Promise.all([getSettings(), dashboard({}), callCostRows()]);
  const ai = aiStatus();
  const c = m.costs;

  return (
    <div>
      <PageHeader
        title="Cost analytics"
        description="What the automation costs to run. Rates are configurable in Settings. Estimated values, projected (mock) usage and recorded usage are labelled separately — no billing data is fabricated."
        actions={<Link href="/settings" className="rounded-lg border border-stone-300 px-3 py-2 text-sm hover:bg-stone-50">Edit cost assumptions</Link>}
      />

      <div className="mb-4 rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900">
        <b>How to read this:</b>{" "}
        {ai.live
          ? `Live AI (${ai.model}) — token counts are recorded from API responses; ₹ cost = tokens × your configured price.`
          : "Mock AI mode — no API calls are made, so token counts are PROJECTED from text length to show roughly what a live model would cost."}{" "}
        Telephony = billed minutes × your configured rate (demo calls are simulated; no telephony bill exists). Email cost counts only emails actually sent.
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Calls processed" value={m.calls} hint={`${m.total} enquiries (${m.repeatCallsMerged} repeat calls merged)`} tags={[m.demoCount ? "demo" : "recorded"]} />
        <Metric label="AI model" value={<span className="text-base">{ai.live ? ai.model : "Mock (no API)"}</span>} hint={`Priced at $${s.aiInputUsdPerMTok} / $${s.aiOutputUsdPerMTok} per M tokens`} />
        <Metric
          label="Input / output tokens"
          value={<span className="text-lg">{c.inputTokens.toLocaleString()} / {c.outputTokens.toLocaleString()}</span>}
          hint={c.tokensAreEstimates ? "Projected — mock mode" : `${c.liveAiCalls} requests recorded from API`}
          tags={[c.tokensAreEstimates ? "estimate" : "recorded"]}
        />
        <Metric label="AI cost per call" value={inr(m.calls ? c.aiInr / m.calls : null, 2)} hint={`${inr(c.aiRecordedInr, 2)} recorded · ${inr(c.aiProjectedInr, 2)} projected`} tags={["estimate"]} />
        <Metric label="Telephony" value={inr(c.telephonyInr)} hint={`${c.billedMinutes} min × ${inr(s.telephonyInrPerMinute, 2)}/min`} tags={["estimate"]} />
        <Metric label="Email service" value={inr(c.emailInr)} hint={`${c.emailsSent} emails actually sent × ${inr(s.emailInrPerMessage, 2)}`} tags={["estimate"]} />
        <Metric label="Recurring costs" value={inr(c.recurringMonthlyInr)} hint={`per month · ${inr(c.recurringProratedInr)} pro-rated over ${c.periodDays} days`} tags={["estimate"]} />
        <Metric label="Estimated monthly operating cost" value={inr(m.projectedMonthlyInr)} hint={`at ${s.expectedMonthlyEnquiries} enquiries/month (configurable)`} tags={["estimate"]} />
        <Metric label="Total for recorded period" value={inr(c.totalInr)} tags={["estimate"]} />
        <Metric label="Cost per enquiry" value={inr(m.costPerEnquiry, 2)} tags={["estimate"]} />
        <Metric label="Cost per qualified enquiry" value={m.costPerQualified === null ? "Unavailable" : inr(m.costPerQualified, 2)} tags={["estimate"]} />
        <Metric label="Front-desk comparison" value="Not modelled" hint="Staff costs aren't in the case files — add one as a recurring cost to compare" tags={["unavailable"]} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card title="Variable cost per day">
          <CostChart data={m.costSeries} />
        </Card>
        <Card title="Configured recurring costs" subtitle="Assumptions — edit in Settings">
          <ul className="divide-y divide-stone-100 text-sm">
            {s.recurring.map((r) => (
              <li key={r.label} className="flex justify-between gap-3 py-1.5">
                <span>{r.label}</span>
                <span className="tabular-nums">{inr(r.inrPerMonth)}</span>
              </li>
            ))}
            <li className="flex justify-between py-1.5 font-semibold">
              <span>Total per month</span>
              <span className="tabular-nums">{inr(c.recurringMonthlyInr)}</span>
            </li>
          </ul>
        </Card>
      </div>

      <Card className="mt-4" title="Per-call cost breakdown" subtitle="AI: tokens × configured price × FX rate. Telephony: minutes rounded up per call × configured rate.">
        <div className="-m-4 overflow-x-auto">
          <table className="w-full min-w-[880px] text-sm">
            <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-4 py-2.5">Call (IST)</th>
                <th className="px-4 py-2.5">Enquiry</th>
                <th className="px-4 py-2.5">Duration</th>
                <th className="px-4 py-2.5">AI requests</th>
                <th className="px-4 py-2.5">Tokens in / out</th>
                <th className="px-4 py-2.5">AI cost</th>
                <th className="px-4 py-2.5">Telephony</th>
                <th className="px-4 py-2.5">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((r) => {
                const aiInr = aiCostUsd(r, s) * s.usdToInr;
                const tel = billedMinutes(r.duration_seconds) * s.telephonyInrPerMinute;
                return (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap px-4 py-2 text-stone-600">{istDateTime(r.ring_at)}</td>
                    <td className="px-4 py-2">
                      <Link href={`/enquiries/${r.enquiry_id}`} className="text-brand-700 hover:underline">{r.ref}</Link> <span className="text-stone-500">{displayName(r.caller_name)}</span>
                    </td>
                    <td className="px-4 py-2 tabular-nums">{secs(r.duration_seconds)}</td>
                    <td className="px-4 py-2 tabular-nums">{r.ai_requests}</td>
                    <td className="px-4 py-2 tabular-nums">
                      {r.input_tokens.toLocaleString()} / {r.output_tokens.toLocaleString()} {r.ai_requests > 0 && <Tag kind={r.all_estimates ? "estimate" : "recorded"} />}
                    </td>
                    <td className="px-4 py-2 tabular-nums">{inr(aiInr, 2)}</td>
                    <td className="px-4 py-2 tabular-nums">{inr(tel, 2)}</td>
                    <td className="px-4 py-2 font-medium tabular-nums">{inr(aiInr + tel, 2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
