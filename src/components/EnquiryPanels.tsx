import { CriterionIcon } from "@/components/ui";
import type { EnquiryFields, QualificationResult } from "@/lib/types";

const DM: Record<string, string> = {
  self: "Decision-maker on the call",
  joint_owner_confirmed: "Joint owner — co-owner on board",
  authorised_representative: "Authorised representative",
  representing_attending: "Representing owners (they'll attend)",
  not_authorised: "Not authorised",
  unknown: "Not confirmed",
};

export function fieldRows(f: EnquiryFields): [string, string | undefined][] {
  return [
    ["Caller name", f.callerName],
    ["Contact", f.phoneConfirmed ? "Caller ID confirmed as best number" : undefined],
    ["Project", [f.projectCategory, f.propertyType, f.outOfScopeType].filter(Boolean).join(" · ") || undefined],
    ["Location", f.location ? `${f.location}${f.locationStatus ? ` (${f.locationStatus.replace("_", " ")})` : ""}` : undefined],
    ["Carpet area", f.carpetAreaSqft ? `${f.carpetAreaSqft.toLocaleString("en-IN")} sq ft` : undefined],
    ["Rooms / spaces", f.rooms?.join(", ")],
    ["Design + execution", f.scopeType ? (f.scopeType === "design_and_execution" ? "Yes" : f.scopeType.replace(/_/g, " ")) : undefined],
    ["Site condition", f.siteCondition ? `${f.siteCondition}${f.rented ? " · rented" : ""}` : f.rented ? "Rented" : undefined],
    ["Timeline", [f.timelineText, f.requiredByDate && `by ~${f.requiredByDate}`, f.timelineFlexible && "flexible", f.startText].filter(Boolean).join(" · ") || undefined],
    ["Budget (volunteered only)", f.budgetText],
    ["Decision-maker", f.decisionMaker ? DM[f.decisionMaker] : undefined],
    ["Referral source", f.referralSource],
    ["Consultation", f.consultationRequested === undefined ? undefined : f.consultationRequested ? `Requested${f.preferredSlot ? ` — ${f.preferredSlot}` : ""}` : "Not now"],
    ["Pricing questions", f.pricingQuestionCount ? `${f.pricingQuestionCount} (deflected, no figures given)` : undefined],
    ["Complaint", f.complaint ? f.complaintDetails ?? "Yes" : undefined],
    ["Missed follow-up", f.missedCommitment ? "Caller says an earlier enquiry was not followed up" : undefined],
  ];
}

export function FieldsTable({ fields, compact = false }: { fields: EnquiryFields; compact?: boolean }) {
  const rows = fieldRows(fields).filter(([k, v]) => v || !compact || ["Caller name", "Location", "Timeline"].includes(k));
  return (
    <dl className="divide-y divide-stone-100 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[minmax(110px,40%)_1fr] gap-2 py-1.5">
          <dt className="text-stone-500">{k}</dt>
          <dd className={v ? "text-stone-900" : "text-stone-400"}>{v ?? (k.startsWith("Budget") ? "Not mentioned — not probed" : "—")}</dd>
        </div>
      ))}
    </dl>
  );
}

export function QualificationPanel({ q }: { q: QualificationResult | null }) {
  if (!q) return <p className="text-sm text-stone-500">No qualification yet.</p>;
  if (q.decision === "not_applicable") {
    return <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{q.summary}</p>;
  }
  const tone =
    q.decision === "qualified" ? "bg-green-50 text-green-900" : q.decision === "needs_clarification" ? "bg-amber-50 text-amber-900" : "bg-stone-100 text-stone-800";
  return (
    <div className="space-y-3">
      <p className={`rounded-lg p-3 text-sm font-medium ${tone}`}>{q.summary}</p>
      <ol className="space-y-2.5">
        {q.criteria.map((c) => (
          <li key={c.id} className="flex gap-2.5">
            <CriterionIcon status={c.status} />
            <div className="min-w-0 text-sm">
              <div className="font-medium text-stone-900">
                {c.id}. {c.name}
              </div>
              <div className="text-stone-600">{c.reason}</div>
              {c.evidence.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {c.evidence.map((e, i) => (
                    <div key={i} className="truncate border-l-2 border-brand-200 pl-2 text-xs italic text-stone-500" title={e}>
                      {e}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
      <p className="text-[11px] leading-relaxed text-stone-400">
        Decided by the deterministic rules engine (qualified.md). AI may help read the conversation but cannot change these results. ⚑ = unclear on criterion 4 or 5 → treated as qualified and flagged, per policy.
      </p>
    </div>
  );
}
