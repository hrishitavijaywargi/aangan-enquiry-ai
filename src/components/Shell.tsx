"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { SystemStatus } from "@/lib/status";

const NAV = [
  { href: "/", label: "Dashboard", icon: "▦" },
  { href: "/calls", label: "Calls", icon: "☎" },
  { href: "/enquiries", label: "Enquiries", icon: "☰" },
  { href: "/handoffs", label: "Handoffs", icon: "✉" },
  { href: "/costs", label: "Cost Analytics", icon: "₹" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];

function Chip({ live, label, title }: { live: boolean; label: string; title: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${live ? "bg-emerald-50 text-emerald-800 ring-emerald-600/30" : "bg-amber-50 text-amber-900 ring-amber-500/40"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-emerald-500" : "bg-amber-500"}`} />
      {label}
    </span>
  );
}

export default function Shell({ status, children }: { status: SystemStatus; children: ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const title = NAV.find((n) => active(n.href))?.label ?? "Aangan Studio";

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-40 w-60 transform border-r border-stone-200 bg-white transition-transform lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex h-16 items-center gap-2 border-b border-stone-100 px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">A</div>
          <div>
            <div className="text-sm font-semibold text-stone-900">Aangan Studio</div>
            <div className="text-[11px] text-stone-500">Enquiry assistant</div>
          </div>
        </div>
        <nav className="space-y-1 p-3">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              onClick={() => setOpen(false)}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${active(n.href) ? "bg-brand-50 text-brand-700" : "text-stone-600 hover:bg-stone-50 hover:text-stone-900"}`}
            >
              <span className="w-4 text-center" aria-hidden>{n.icon}</span>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="absolute bottom-0 w-full border-t border-stone-100 p-4 text-[11px] leading-relaxed text-stone-500">
          Incoming phone enquiries only. WhatsApp &amp; web form are future extensions.
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setOpen(false)} />}

      <div className="lg:pl-60">
        {/* Top bar */}
        <header className="sticky top-0 z-20 border-b border-stone-200 bg-white/90 backdrop-blur">
          <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
            <button className="rounded-md p-2 text-stone-600 hover:bg-stone-100 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
              ☰
            </button>
            <div className="text-sm font-semibold text-stone-900">{title}</div>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
              <Chip live={status.telephony.live} label={status.telephony.live ? "Live telephony" : "Simulated calls"} title={status.telephony.message} />
              <Chip live={status.ai.live} label={status.ai.live ? `AI: ${status.ai.model}` : "Mock AI"} title={status.ai.message} />
              <Chip live={status.email.live} label={status.email.live ? "Email: SMTP" : "Email: local only"} title={status.email.message} />
            </div>
          </div>
          {status.demoRows > 0 && (
            <div className="border-t border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-900 sm:px-6">
              <b>Demo mode.</b> {status.demoRows} enquiries are demo data generated from simulated calls based on the anonymised Sept 2026 transcripts. No real phone calls are being answered.
            </div>
          )}
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
