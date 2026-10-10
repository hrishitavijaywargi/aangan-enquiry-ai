"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";
import type { SystemStatus } from "@/lib/status";
import type { Settings } from "@/lib/types";

const NUM_FIELDS: { key: keyof Settings; label: string; hint: string; step?: string }[] = [
  { key: "aiInputUsdPerMTok", label: "AI input price (USD / million tokens)", hint: "Default: Anthropic list price for claude-opus-5-5 at build time — verify current pricing", step: "0.01" },
  { key: "aiOutputUsdPerMTok", label: "AI output price (USD / million tokens)", hint: "As above", step: "0.01" },
  { key: "usdToInr", label: "USD → INR exchange rate", hint: "Assumption — update to today's rate", step: "0.01" },
  { key: "telephonyInrPerMinute", label: "Telephony cost (₹ per minute)", hint: "Assumption — use your provider's India inbound rate", step: "0.01" },
  { key: "emailInrPerMessage", label: "Email cost (₹ per email sent)", hint: "0 on most SMTP free tiers", step: "0.01" },
  { key: "expectedMonthlyEnquiries", label: "Expected enquiries per month", hint: "Case: ~200/month — used for the monthly projection" },
  { key: "officeStartHour", label: "Office opens (hour, 24h)", hint: "Case: 10am" },
  { key: "officeEndHour", label: "Office closes (hour, 24h)", hint: "Case: 7pm" },
  { key: "dedupeWindowDays", label: "Repeat-call merge window (days)", hint: "Calls from the same number within this window join the same enquiry" },
];

export default function SettingsForm({ initial, status }: { initial: Settings; status: SystemStatus }) {
  const router = useRouter();
  const [s, setS] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const call = async (label: string, url: string, method: string, body?: unknown) => {
    setBusy(label);
    setMsg(null);
    try {
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error ?? "Request failed");
      return j;
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
      return null;
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    const j = await call("save", "/api/settings", "PUT", s);
    if (j) {
      setS(j.settings);
      setMsg({ ok: true, text: "Settings saved. Cost figures across the app now use these values." });
      router.refresh();
    }
  };

  const input = "mt-1 w-full rounded-lg border border-stone-300 px-2.5 py-1.5 text-sm";

  return (
    <div className="space-y-4">
      <Card title="Integrations" subtitle="Configured with environment variables in .env.local (see .env.example). Secrets never reach the browser.">
        <ul className="space-y-2 text-sm">
          {[
            ["Telephony", status.telephony.live, status.telephony.message],
            ["AI model", status.ai.live, status.ai.message],
            ["Email", status.email.live, status.email.message],
            ["Database", true, status.database],
          ].map(([name, live, text]) => (
            <li key={String(name)} className="flex gap-2">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${live ? "bg-emerald-500" : "bg-amber-500"}`} />
              <span>
                <b>{String(name)}:</b> {String(text)}
              </span>
            </li>
          ))}
        </ul>
        <h3 className="mt-4 text-sm font-semibold text-stone-800">Optional integrations</h3>
        <p className="text-xs text-stone-500">Each turns on when its key is set. They run after live calls only; demo data never triggers them.</p>
        <ul className="mt-2 grid gap-2 md:grid-cols-2">
          {status.integrations.map((i) => (
            <li key={i.key} className="rounded-lg border border-stone-200 p-2.5 text-sm">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${i.configured ? "bg-emerald-500" : "bg-stone-300"}`} />
                <b>{i.name}</b>
                <span className={`ml-auto text-xs ${i.configured ? "text-emerald-700" : "text-stone-400"}`}>{i.configured ? "On" : "Off"}</span>
              </div>
              <div className="mt-1 text-xs text-stone-500">{i.purpose}</div>
              <div className="mt-0.5 text-xs text-stone-400">{i.message}</div>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Cost & operating assumptions" subtitle="Every cost on the dashboard is calculated from these. They are estimates, not bills.">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {NUM_FIELDS.map((f) => (
            <label key={f.key} className="text-xs font-medium text-stone-600">
              {f.label}
              <input type="number" min={0} step={f.step ?? "1"} className={input} value={String(s[f.key] as number)} onChange={(e) => setS({ ...s, [f.key]: e.target.value === "" ? "" : Number(e.target.value) })} />
              <span className="mt-0.5 block font-normal text-stone-400">{f.hint}</span>
            </label>
          ))}
        </div>

        <h3 className="mt-5 text-sm font-semibold text-stone-800">Recurring monthly costs</h3>
        <div className="mt-2 space-y-2">
          {s.recurring.map((r, i) => (
            <div key={i} className="flex gap-2">
              <input className={`${input} mt-0 flex-1`} value={r.label} onChange={(e) => setS({ ...s, recurring: s.recurring.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} aria-label="Cost label" />
              <input type="number" min={0} className={`${input} mt-0 w-32`} value={r.inrPerMonth} onChange={(e) => setS({ ...s, recurring: s.recurring.map((x, j) => (j === i ? { ...x, inrPerMonth: Number(e.target.value) } : x)) })} aria-label="₹ per month" />
              <button className="rounded-lg px-2 text-stone-400 hover:bg-red-50 hover:text-red-700" onClick={() => setS({ ...s, recurring: s.recurring.filter((_, j) => j !== i) })} aria-label="Remove">
                ✕
              </button>
            </div>
          ))}
          <button className="text-sm font-medium text-brand-700 hover:underline" onClick={() => setS({ ...s, recurring: [...s.recurring, { label: "New cost", inrPerMonth: 0 }] })}>
            + Add recurring cost
          </button>
        </div>

        <label className="mt-5 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={s.autoSendHandoffs} onChange={(e) => setS({ ...s, autoSendHandoffs: e.target.checked })} />
          Deliver handoff emails automatically when a call ends (sent via SMTP if configured, otherwise saved locally)
        </label>

        <div className="mt-5 flex flex-wrap gap-2">
          <button onClick={save} disabled={!!busy} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
            {busy === "save" ? "Saving…" : "Save settings"}
          </button>
          <button
            onClick={async () => {
              const j = await call("defaults", "/api/settings", "DELETE");
              if (j) {
                setS(j.settings);
                setMsg({ ok: true, text: "Restored default assumptions." });
                router.refresh();
              }
            }}
            disabled={!!busy}
            className="rounded-lg border border-stone-300 px-4 py-2 text-sm hover:bg-stone-50"
          >
            Restore defaults
          </button>
        </div>
      </Card>

      <Card title="Demo data" subtitle="Demo enquiries are generated by running the Sept 2026 phone transcripts through the live workflow.">
        <div className="flex flex-wrap gap-2">
          <button
            disabled={!!busy}
            onClick={async () => {
              if (!confirm("Delete all enquiries, calls and handoffs and re-create the demo data?")) return;
              const j = await call("reset", "/api/demo/reset", "POST");
              if (j) {
                setMsg({ ok: true, text: `Demo data reset: ${j.enquiries} enquiries from ${j.calls} calls.` });
                router.refresh();
              }
            }}
            className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy === "reset" ? "Resetting…" : "Reset demo data"}
          </button>
          <button
            disabled={!!busy}
            onClick={async () => {
              if (!confirm("Delete ALL data and start with an empty system? Demo data will not be re-created.")) return;
              const j = await call("clear", "/api/demo/clear", "POST");
              if (j) {
                setMsg({ ok: true, text: "All data cleared. New calls will be the only records." });
                router.refresh();
              }
            }}
            className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            Clear all data
          </button>
        </div>
      </Card>

      {msg && <p className={`rounded-lg p-3 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>{msg.text}</p>}
    </div>
  );
}
