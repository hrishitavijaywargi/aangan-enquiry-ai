/**
 * Email handoff notes. Email was chosen over Telegram because the designer needs a complete,
 * readable, forwardable record that sits alongside the project thread (see AUTOMATION_BRIEF.md).
 */
import { outstandingItems } from "./agent";
import { CRITERIA_NAMES } from "./qualification";
import type { EnquiryFields, QualificationResult } from "./types";

export interface HandoffInput {
  ref: string;
  phoneMasked: string;
  createdAtIst: string;
  afterHours: boolean;
  fields: EnquiryFields;
  qualification: QualificationResult;
  summary: string;
  callCount: number;
  isDemo: boolean;
}

export interface HandoffNote {
  kind: "qualified_lead" | "escalation";
  subject: string;
  text: string;
  html: string;
  urgent: boolean;
}

const DM_LABEL: Record<string, string> = {
  self: "Caller is the decision-maker",
  joint_owner_confirmed: "Joint owner — co-owner on board",
  authorised_representative: "Authorised representative",
  representing_attending: "Representing the owners — they will attend the consultation (flag)",
  not_authorised: "Not authorised",
  unknown: "Not confirmed (not pushed, per policy)",
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function timelineLine(f: EnquiryFields): string {
  const parts: string[] = [];
  if (f.timelineText) parts.push(`“${f.timelineText}”`);
  if (f.requiredByDate) parts.push(`complete by ~${f.requiredByDate}`);
  if (f.timelineFlexible) parts.push("flexible");
  if (f.startText) parts.push(f.startText);
  if (f.siteAvailableInWeeks !== undefined) parts.push(f.siteAvailableInWeeks === 0 ? "site available now" : `site available in ~${f.siteAvailableInWeeks} weeks`);
  return parts.join("; ") || "Not stated";
}

function nextAction(f: EnquiryFields, kind: HandoffNote["kind"]): string {
  if (kind === "escalation") return "Studio head / senior team member to call the client back today. Do not treat as a sales lead. Any resolution or commitment must come from the studio, not the AI.";
  const call = f.consultationRequested
    ? `Call the client to confirm the consultation slot${f.preferredSlot ? ` (preference: “${f.preferredSlot}”)` : ""}.`
    : "Call the client to introduce yourself and offer a consultation.";
  const extra = f.missedCommitment ? " PRIORITY: the client said an earlier enquiry was not followed up — call same day." : "";
  const price = (f.pricingQuestionCount ?? 0) > 0 ? " Be ready to walk them through pricing at the consultation (they asked)." : "";
  return call + extra + price;
}

export function buildHandoff(input: HandoffInput): HandoffNote {
  const f = input.fields;
  const q = input.qualification;
  const kind: HandoffNote["kind"] = f.complaint ? "escalation" : "qualified_lead";
  const urgent = kind === "escalation" || !!f.missedCommitment;
  const name = f.callerName ?? "Unknown caller";
  const demoTag = input.isDemo ? "[DEMO] " : "";

  const subject =
    kind === "escalation"
      ? `${demoTag}URGENT — existing client escalation: ${name} (${input.ref})`
      : `${demoTag}${urgent ? "PRIORITY — " : ""}Qualified lead: ${name} — ${f.propertyType ?? f.projectCategory ?? "project"}, ${f.location ?? "location TBC"} (${input.ref})`;

  const rows: [string, string][] =
    kind === "escalation"
      ? [
          ["Caller", name],
          ["Contact", `${input.phoneMasked}${f.phoneConfirmed ? " (confirmed)" : ""}${f.email ? ` · ${f.email}` : ""}`],
          ["Received", `${input.createdAtIst} IST${input.afterHours ? " (after hours)" : ""}`],
          ["What the client said", f.complaintDetails ?? "—"],
          ["Project / location", [f.propertyType, f.location].filter(Boolean).join(", ") || "Not captured"],
        ]
      : [
          ["Caller", name],
          ["Contact", `${input.phoneMasked}${f.phoneConfirmed ? " (confirmed as best number)" : ""}${f.email ? ` · ${f.email}` : ""}`],
          ["Received", `${input.createdAtIst} IST${input.afterHours ? " (after hours — answered by AI)" : ""}${input.callCount > 1 ? ` · ${input.callCount} calls merged` : ""}`],
          ["Project type", `${f.projectCategory ?? "—"}${f.propertyType ? ` · ${f.propertyType}` : ""}${f.rented ? " · rented (no structural changes)" : ""}`],
          ["Location", f.location ?? "—"],
          ["Carpet area", f.carpetAreaSqft ? `~${f.carpetAreaSqft.toLocaleString("en-IN")} sq ft` : "Not confirmed"],
          ["Scope", `${f.rooms?.join(", ") ?? "—"}${f.scopeType === "design_and_execution" ? " · design + execution" : ""}`],
          ["Site readiness", f.siteCondition ?? "Not confirmed"],
          ["Timeline", timelineLine(f)],
          ["Budget", f.budgetText ? `Volunteered: “${f.budgetText}”` : "Not mentioned (not probed, per policy)"],
          ["Decision-maker", `${DM_LABEL[f.decisionMaker ?? "unknown"]}${f.decisionText ? ` — “${f.decisionText}”` : ""}`],
          ["Referral source", f.referralSource ?? "—"],
          ["Consultation", f.consultationRequested ? `Requested${f.preferredSlot ? ` — “${f.preferredSlot}”` : ""}` : f.consultationRequested === false ? "Not yet — caller not ready to book" : "Not asked"],
        ];

  const criteria = q.criteria.map((c) => `${c.status === "pass" ? "✔" : c.status === "assumed_pass" ? "⚑" : c.status === "fail" ? "✘" : "?"} ${c.id}. ${CRITERIA_NAMES[c.id]} — ${c.reason}`);
  const missing = kind === "escalation" ? [] : outstandingItems(f, q);
  const action = nextAction(f, kind);

  const text = [
    kind === "escalation" ? "EXISTING-CLIENT ESCALATION — needs immediate human attention" : "QUALIFIED LEAD — ready for designer follow-up",
    input.isDemo ? "(Demo data — generated from a simulated call. Not a real client.)" : "",
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    kind === "escalation" ? "Qualification: not applicable (complaint, not a sales lead)" : `Qualification: ${q.summary}`,
    ...criteria.map((c) => `  ${c}`),
    "",
    missing.length ? "Missing information / uncertainties:" : "Missing information / uncertainties: none",
    ...missing.map((m) => `  • ${m}`),
    "",
    "Call summary:",
    input.summary,
    "",
    `Recommended next action: ${action}`,
    "",
    `— Aangan Studio enquiry assistant · ref ${input.ref}`,
  ]
    .filter((l, i, a) => !(l === "" && a[i - 1] === ""))
    .join("\n");

  const html = `<!doctype html><html><body style="font-family:Inter,Segoe UI,Arial,sans-serif;color:#1f2937;max-width:680px;margin:0 auto">
<div style="background:${kind === "escalation" ? "#b91c1c" : urgent ? "#b45309" : "#7a4826"};color:#fff;padding:14px 18px;border-radius:10px 10px 0 0">
<div style="font-size:12px;opacity:.85">${input.isDemo ? "DEMO DATA · " : ""}Aangan Studio · ${esc(input.ref)}</div>
<div style="font-size:18px;font-weight:600">${kind === "escalation" ? "Existing-client escalation — immediate attention" : `${urgent ? "Priority " : ""}Qualified lead for a designer`}</div></div>
<div style="border:1px solid #e5e7eb;border-top:0;padding:16px 18px;border-radius:0 0 10px 10px">
<table style="width:100%;border-collapse:collapse;font-size:14px">${rows.map(([k, v]) => `<tr><td style="padding:6px 8px;color:#6b7280;width:170px;vertical-align:top">${esc(k)}</td><td style="padding:6px 8px">${esc(v)}</td></tr>`).join("")}</table>
${kind === "escalation" ? "" : `<h3 style="font-size:15px;margin:18px 0 6px">Qualification — ${esc(q.summary)}</h3><ul style="font-size:13px;padding-left:18px">${criteria.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>`}
${missing.length ? `<h3 style="font-size:15px;margin:18px 0 6px">Missing information / uncertainties</h3><ul style="font-size:13px;padding-left:18px">${missing.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>` : ""}
<h3 style="font-size:15px;margin:18px 0 6px">Call summary</h3><p style="font-size:14px;line-height:1.5">${esc(input.summary)}</p>
<div style="background:#fbf6f1;border-left:4px solid #b5733d;padding:10px 12px;font-size:14px"><b>Recommended next action:</b> ${esc(action)}</div>
</div></body></html>`;

  return { kind, subject, text, html, urgent };
}
