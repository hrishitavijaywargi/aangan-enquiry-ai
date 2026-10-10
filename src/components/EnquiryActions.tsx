"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Records what happened after the call — the only source of conversion data on the dashboard. */
export function OutcomeEditor({ id, consultation, project }: { id: string; consultation: string; project: string }) {
  const router = useRouter();
  const [c, setC] = useState(consultation);
  const [p, setP] = useState(project);
  const [msg, setMsg] = useState<string | null>(null);
  const save = async () => {
    const r = await fetch(`/api/enquiries/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ consultation_status: c, project_outcome: p }) });
    const j = await r.json();
    setMsg(j.error ?? "Saved — dashboard conversion metrics now include this record.");
    router.refresh();
  };
  const sel = "mt-1 block w-full rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm";
  return (
    <div className="space-y-2 text-sm">
      <label className="block text-xs text-stone-500">
        Consultation
        <select className={sel} value={c} onChange={(e) => setC(e.target.value)}>
          <option value="unknown">Unknown (not recorded)</option>
          <option value="scheduled">Scheduled</option>
          <option value="completed">Completed</option>
          <option value="no_show">No-show</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </label>
      <label className="block text-xs text-stone-500">
        Project outcome
        <select className={sel} value={p} onChange={(e) => setP(e.target.value)}>
          <option value="unknown">Unknown (not recorded)</option>
          <option value="won">Won</option>
          <option value="lost">Lost</option>
        </select>
      </label>
      <button onClick={save} className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-medium text-white">
        Save outcome
      </button>
      {msg && <p className="text-xs text-stone-500">{msg}</p>}
    </div>
  );
}

/** Sends via SMTP if configured; otherwise reports honestly that it was only saved locally. */
export function SendHandoffButton({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const send = async () => {
    setBusy(true);
    const r = await fetch(`/api/handoffs/${id}/send`, { method: "POST" });
    const j = await r.json();
    setBusy(false);
    if (j.status === "sent") setMsg("Sent via SMTP.");
    else if (j.status === "saved_locally") setMsg(`Not sent — ${j.error} Saved as ${j.eml_path}`);
    else setMsg(`Not sent — ${j.error ?? "unknown error"}`);
    router.refresh();
  };
  return (
    <div>
      <button onClick={send} disabled={busy} className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
        {busy ? "Sending…" : status === "sent" ? "Send again" : "Send email"}
      </button>
      {msg && <p className="mt-1.5 max-w-md break-all text-xs text-stone-600">{msg}</p>}
    </div>
  );
}

