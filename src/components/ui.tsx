import type { ReactNode } from "react";
import { STATUS_META } from "@/lib/format";

export function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? STATUS_META.in_progress;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${m.cls}`}>
      <span aria-hidden>{m.icon}</span>
      {m.label}
    </span>
  );
}

export function Card({ title, subtitle, children, right, className = "" }: { title?: ReactNode; subtitle?: ReactNode; children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-stone-200 bg-white shadow-sm ${className}`}>
      {(title || right) && (
        <div className="flex items-start justify-between gap-3 border-b border-stone-100 px-4 py-3">
          <div>
            {title && <h2 className="text-sm font-semibold text-stone-900">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-stone-500">{subtitle}</p>}
          </div>
          {right}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export type Provenance = "recorded" | "estimate" | "demo" | "unavailable";
const PROV: Record<Provenance, { label: string; cls: string; title: string }> = {
  recorded: { label: "Recorded", cls: "bg-emerald-50 text-emerald-700", title: "Calculated from stored records" },
  estimate: { label: "Estimate", cls: "bg-violet-50 text-violet-700", title: "Configured rate × recorded usage — not a bill" },
  demo: { label: "Demo data", cls: "bg-amber-50 text-amber-800", title: "Derived from simulated demo calls" },
  unavailable: { label: "Unavailable", cls: "bg-stone-100 text-stone-600", title: "Not recorded yet — no value assumed" },
};

export function Tag({ kind }: { kind: Provenance }) {
  const p = PROV[kind];
  return (
    <span title={p.title} className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${p.cls}`}>
      {p.label}
    </span>
  );
}

export function Metric({ label, value, hint, tags = [] }: { label: string; value: ReactNode; hint?: ReactNode; tags?: Provenance[] }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <span className="text-xs font-medium text-stone-500">{label}</span>
        <span className="flex gap-1">{tags.map((t) => <Tag key={t} kind={t} />)}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-stone-900">{value}</div>
      {hint && <div className="mt-1 text-xs text-stone-500">{hint}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold text-stone-900">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-stone-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function CriterionIcon({ status }: { status: string }) {
  const map: Record<string, [string, string, string]> = {
    pass: ["✓", "bg-green-100 text-green-800", "Pass"],
    assumed_pass: ["⚑", "bg-amber-100 text-amber-800", "Treated as pass — flagged"],
    fail: ["✕", "bg-red-100 text-red-800", "Fail"],
    unclear: ["?", "bg-stone-200 text-stone-700", "Unclear"],
  };
  const [icon, cls, label] = map[status] ?? map.unclear;
  return (
    <span title={label} aria-label={label} className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${cls}`}>
      {icon}
    </span>
  );
}
