"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { FieldsTable, QualificationPanel } from "@/components/EnquiryPanels";
import { Card, StatusBadge } from "@/components/ui";
import type { AgentState, EnquiryFields, QualificationResult } from "@/lib/types";

export interface ScenarioOption {
  key: string;
  label: string;
  source: string;
  rubricTag: string | null;
  adapted: string | null;
  phoneMasked: string;
}

type Phase = "idle" | "ringing" | "connected" | "ended";
interface Msg {
  role: "agent" | "caller" | "system";
  text: string;
  tags?: string[];
}
interface Outcome {
  enquiry: { id: string; ref: string; status: string; call_count: number; urgent: number };
  handoffs: { id: string; kind: string; status: string; subject: string; error: string | null }[];
}

const RING_MS = 2500;

async function api<T>(url: string, body?: unknown, method = "POST"): Promise<T> {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error ?? `Request failed (${r.status})`);
  return j as T;
}

const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export default function CallSimulator({ scenarios }: { scenarios: ScenarioOption[] }) {
  const [mode, setMode] = useState<"scenario" | "custom">("scenario");
  const [scenarioKey, setScenarioKey] = useState(scenarios[0]?.key ?? "");
  const [customPhone, setCustomPhone] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [callId, setCallId] = useState<string | null>(null);
  const [callerId, setCallerId] = useState("");
  const [repeat, setRepeat] = useState(false);
  const [afterHours, setAfterHours] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [fields, setFields] = useState<EnquiryFields>({});
  const [qual, setQual] = useState<QualificationResult | null>(null);
  const [state, setState] = useState<AgentState | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ringAt, setRingAt] = useState(0);
  const [answeredAfter, setAnsweredAfter] = useState<number | null>(null);
  const [endedAt, setEndedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoRef = useRef(false);
  const scenario = scenarios.find((s) => s.key === scenarioKey);

  useEffect(() => {
    if (phase !== "ringing" && phase !== "connected") return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [phase]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs]);

  const suggest = useCallback(async (id: string) => {
    if (mode !== "scenario") return null;
    const s = await api<{ text: string | null; hangUp?: boolean }>(`/api/calls/${id}/suggest`, undefined, "GET");
    setInput(s.text ?? "");
    return s;
  }, [mode]);

  const finish = useCallback(async (id: string, reason: "completed" | "caller_hung_up" | "dropped") => {
    autoRef.current = false;
    setAuto(false);
    const o = await api<Outcome>(`/api/calls/${id}/end`, { reason });
    setOutcome(o);
    setPhase("ended");
    setEndedAt(Date.now());
    if (reason !== "completed") setMsgs((m) => [...m, { role: "system", text: reason === "dropped" ? "Line dropped." : "Caller hung up." }]);
  }, []);

  const start = async () => {
    setError(null);
    setMsgs([]);
    setFields({});
    setQual(null);
    setState(null);
    setOutcome(null);
    setAnsweredAfter(null);
    setEndedAt(null);
    setInput("");
    try {
      const s = await api<{ callId: string; repeatCaller: boolean; afterHours: boolean; phoneMasked: string }>("/api/calls/start", mode === "scenario" ? { scenarioKey } : { phone: customPhone || undefined });
      setCallId(s.callId);
      setCallerId(s.phoneMasked);
      setRepeat(s.repeatCaller);
      setAfterHours(s.afterHours);
      setRingAt(Date.now());
      setPhase("ringing");
      await new Promise((r) => setTimeout(r, RING_MS));
      const a = await api<{ reply: string; responseSeconds: number; qualification: QualificationResult; fields: EnquiryFields; state: AgentState }>(`/api/calls/${s.callId}/answer`);
      setAnsweredAfter(a.responseSeconds);
      setPhase("connected");
      setMsgs((m) => [...m, ...(s.repeatCaller ? [{ role: "system" as const, text: "Repeat caller — merged into their existing enquiry (not counted twice)." }] : []), { role: "agent", text: a.reply }]);
      setFields(a.fields);
      setQual(a.qualification);
      setState(a.state);
      await suggest(s.callId);
    } catch (e) {
      setError((e as Error).message);
      setPhase("idle");
    }
  };

  const say = useCallback(async (text: string) => {
    if (!callId || !text.trim()) return false;
    setBusy(true);
    setError(null);
    setMsgs((m) => [...m, { role: "caller", text }]);
    setInput("");
    try {
      const r = await api<{ reply: string; ended: boolean; events: string[]; qualification: QualificationResult; fields: EnquiryFields; state: AgentState }>(`/api/calls/${callId}/say`, { text });
      setMsgs((m) => [...m, { role: "agent", text: r.reply, tags: r.events }]);
      setFields(r.fields);
      setQual(r.qualification);
      setState(r.state);
      if (r.ended) {
        await finish(callId, "completed");
        return false;
      }
      const s = await suggest(callId);
      if (s?.hangUp) {
        await finish(callId, "dropped");
        return false;
      }
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }, [callId, finish, suggest]);

  // Auto-play: the simulated caller answers each question in turn.
  useEffect(() => {
    if (!auto || busy || phase !== "connected" || !input) return;
    autoRef.current = true;
    const t = setTimeout(() => autoRef.current && say(input), 900);
    return () => clearTimeout(t);
  }, [auto, busy, phase, input, say]);

  const elapsed = phase === "idle" ? 0 : (endedAt ?? now) - ringAt;
  const statusLabel = { idle: "No active call", ringing: "Ringing…", connected: "Connected — AI answering", ended: "Call ended" }[phase];
  const statusCls = { idle: "bg-stone-100 text-stone-600", ringing: "animate-pulse bg-amber-100 text-amber-800", connected: "bg-emerald-100 text-emerald-800", ended: "bg-stone-200 text-stone-700" }[phase];
  const inCall = phase === "ringing" || phase === "connected";

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      {/* Setup + call */}
      <div className="min-w-0 space-y-4">
        <Card title="Choose an incoming call" subtitle="Simulated — no telephony provider or API key needed.">
          <div className="grid gap-3 md:grid-cols-2">
          <div>
          <div className="mb-3 flex rounded-lg bg-stone-100 p-1 text-sm">
            {(["scenario", "custom"] as const).map((m) => (
              <button key={m} disabled={inCall} onClick={() => setMode(m)} className={`flex-1 rounded-md px-2 py-1.5 font-medium ${mode === m ? "bg-white shadow-sm text-stone-900" : "text-stone-500"}`}>
                {m === "scenario" ? "Sample enquiry" : "Custom caller"}
              </button>
            ))}
          </div>
          {mode === "scenario" ? (
            <div className="space-y-2">
              <select disabled={inCall} className="w-full rounded-lg border border-stone-300 bg-white px-2 py-2 text-sm" value={scenarioKey} onChange={(e) => setScenarioKey(e.target.value)}>
                {scenarios.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.source.split(" ")[0]} · {s.label}
                  </option>
                ))}
              </select>
              {scenario && (
                <div className="space-y-1 rounded-lg bg-stone-50 p-2.5 text-xs text-stone-600">
                  <div>
                    Source: <b>{scenario.source}</b> 
                  </div>
                  {scenario.rubricTag && <div className="text-brand-700">Demonstrates: {scenario.rubricTag}</div>}
                  {scenario.adapted && <div className="italic text-stone-500">{scenario.adapted}</div>}
                  <div className="text-stone-400">Replayed now with a fresh demo caller ID, so it is recorded as a new demo enquiry. To see repeat-call merging, use Custom caller with the same number twice.</div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2 text-sm">
              <label className="block text-xs text-stone-500">
                Caller number (optional — reuse a number to test repeat-call merging)
                <input disabled={inCall} className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-2 text-sm" placeholder="e.g. +91 90000 12345" value={customPhone} onChange={(e) => setCustomPhone(e.target.value)} />
              </label>
              <p className="text-xs text-stone-500">You type the caller&apos;s answers yourself. Try asking for a price!</p>
            </div>
          )}
          </div>
          <div className="flex flex-col justify-end">
            <ul className="mb-3 space-y-1 text-xs text-stone-500">
              <li>1. Start the call — it rings, then the AI answers (response time is measured).</li>
              <li>2. Send the caller&apos;s replies, or press <b>Auto-play</b> for a sample enquiry.</li>
              <li>3. Watch the record and qualification update live; the outcome and email handoff appear when the call ends.</li>
            </ul>
            <button onClick={start} disabled={inCall} className="w-full rounded-lg bg-brand-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
              ☎ Start demo call
            </button>
          </div>
          </div>
        </Card>

      {/* Call */}
      <Card className="flex min-h-[560px] flex-col" title={
        <span className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusCls}`}>{statusLabel}</span>
          <span className="font-mono text-sm tabular-nums text-stone-700">{fmtClock(elapsed)}</span>
        </span>
      } right={
        <div className="text-right text-xs text-stone-500">
          <div>Caller: <b className="text-stone-800">{callerId || "—"}</b>{repeat && " · repeat caller"}</div>
          {afterHours && <div className="text-amber-700">After office hours (studio closed)</div>}
        </div>
      }>
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded bg-amber-50 px-2 py-1 font-medium text-amber-900">DEMO — simulated call, no real phone line</span>
          {answeredAfter !== null && (
            <span className={`rounded px-2 py-1 font-medium ${answeredAfter <= 300 ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>
              {answeredAfter <= 300 ? "✓" : "✕"} Answered in {answeredAfter.toFixed(1)} s (target ≤ 5 min)
            </span>
          )}
          {qual && <span className="text-stone-500">Live decision: <b>{qual.decision.replace(/_/g, " ")}</b></span>}
        </div>

        <div ref={scrollRef} className="flex-1 space-y-2.5 overflow-y-auto rounded-lg bg-stone-50 p-3" style={{ maxHeight: 460 }}>
          {msgs.length === 0 && <p className="py-16 text-center text-sm text-stone-400">{phase === "ringing" ? "☎ Ringing… the AI will pick up in a moment." : "Start a demo call to see the conversation."}</p>}
          {msgs.map((m, i) =>
            m.role === "system" ? (
              <div key={i} className="text-center text-xs italic text-stone-500">{m.text}</div>
            ) : (
              <div key={i} className={`flex ${m.role === "caller" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${m.role === "caller" ? "rounded-br-sm bg-brand-600 text-white" : "rounded-bl-sm border border-stone-200 bg-white text-stone-800"}`}>
                  <div className={`mb-0.5 text-[10px] font-semibold uppercase tracking-wide ${m.role === "caller" ? "text-brand-100" : "text-stone-400"}`}>{m.role === "caller" ? "Caller" : "Aangan AI assistant"}</div>
                  {m.text}
                  {m.tags && m.tags.filter((t) => t !== "after_hours").length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {m.tags.map((t) => (
                        <span key={t} className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${t.includes("pricing") || t.includes("guard") ? "bg-violet-50 text-violet-700" : t.includes("escalat") || t.includes("missed") ? "bg-red-50 text-red-700" : "bg-stone-100 text-stone-600"}`}>
                          {t.replace(/_/g, " ").replace(":", ": ")}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ),
          )}
          {busy && <div className="text-xs text-stone-400">AI is replying…</div>}
        </div>

        {phase === "connected" && (
          <div className="mt-3 space-y-2">
            <div className="flex gap-2">
              <input
                className="min-w-0 flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm"
                placeholder="Type what the caller says…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !busy && say(input)}
                disabled={busy}
              />
              <button onClick={() => say(input)} disabled={busy || !input.trim()} className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
                Send
              </button>
            </div>
            <div className="flex flex-wrap gap-2 text-sm">
              {mode === "scenario" && (
                <button onClick={() => setAuto((a) => !a)} className={`rounded-lg px-3 py-1.5 font-medium ${auto ? "bg-amber-100 text-amber-900" : "bg-brand-50 text-brand-700 hover:bg-brand-100"}`}>
                  {auto ? "⏸ Pause auto-play" : "▶ Auto-play caller"}
                </button>
              )}
              <button onClick={() => callId && finish(callId, "caller_hung_up")} className="rounded-lg bg-red-50 px-3 py-1.5 font-medium text-red-700 hover:bg-red-100">
                Caller hangs up
              </button>
              {mode === "scenario" && <span className="self-center text-xs text-stone-400">The box is pre-filled with the scenario caller&apos;s answer — edit it freely.</span>}
            </div>
          </div>
        )}
        {error && <p className="mt-2 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}

        {outcome && (
          <div className="mt-3 rounded-lg border border-stone-200 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <b>Outcome:</b> <StatusBadge status={outcome.enquiry.status} />
              <span className="text-stone-500">{outcome.enquiry.ref}{outcome.enquiry.call_count > 1 ? ` · ${outcome.enquiry.call_count} calls merged` : ""}</span>
              <Link href={`/enquiries/${outcome.enquiry.id}`} className="ml-auto font-medium text-brand-700 hover:underline">Open enquiry →</Link>
            </div>
            {outcome.handoffs.map((h) => (
              <div key={h.id} className="mt-2 rounded bg-stone-50 p-2 text-xs text-stone-600">
                ✉ {h.kind === "escalation" ? "Escalation email" : "Designer handoff email"} — <b>{h.status === "sent" ? "sent" : h.status === "saved_locally" ? "saved locally, NOT sent (no SMTP configured)" : h.status}</b>: {h.subject}
                <Link href={`/handoffs?id=${h.id}`} className="ml-2 font-medium text-brand-700 hover:underline">Preview</Link>
              </div>
            ))}
            {!outcome.handoffs.length && <p className="mt-2 text-xs text-stone-500">No handoff: only qualified leads and escalations are emailed.</p>}
          </div>
        )}
      </Card>
      </div>

      {/* Live record */}
      <div className="space-y-4">
        <Card title="Information collected" subtitle="Saved to the enquiry record as the call goes.">
          <FieldsTable fields={fields} compact />
        </Card>
        <Card title="Qualification status" subtitle="Re-evaluated after every answer.">
          <QualificationPanel q={qual} />
        </Card>
        <Card title="Questions asked by the AI" subtitle="One at a time; never repeated once answered.">
          {state?.questionsAsked.length ? (
            <ol className="list-decimal space-y-1 pl-4 text-sm text-stone-700">
              {state.questionsAsked.map((q, i) => <li key={i}>{q}</li>)}
            </ol>
          ) : (
            <p className="text-sm text-stone-400">None yet.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
