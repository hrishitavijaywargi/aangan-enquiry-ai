/**
 * AI layer. Two jobs only:
 *   1. help interpret a caller utterance (fill gaps in extracted fields), and
 *   2. write the call summary for the designer handoff.
 * It never decides qualification and never writes caller-facing pricing text — those are
 * deterministic (qualification.ts, pricingGuard.ts). Without an API key the deterministic
 * mock provider is used and usage is recorded as a labelled ESTIMATE, never as real usage.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { EnquiryFields } from "../types";

export interface AIUsage {
  inputTokens: number;
  outputTokens: number;
  isEstimate: boolean; // true = projected from text length (no API call made)
  note?: string;
}

export interface AIProvider {
  name: "mock" | "anthropic";
  model: string;
  live: boolean;
  extractFields(utterance: string, known: EnquiryFields): Promise<{ fields: Partial<EnquiryFields>; usage: AIUsage }>;
  summarise(transcript: string, fields: EnquiryFields, outcome: string): Promise<{ text: string; usage: AIUsage; source: "llm" | "template" }>;
}

export interface AIStatus {
  provider: "mock" | "anthropic";
  model: string;
  live: boolean;
  message: string;
}

/** Rough token estimate used ONLY for labelled projections in mock mode (~4 chars per token). */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

const EXTRACT_SYSTEM = `You help the front desk of Aangan Studio, an interior design studio in Pune, interpret one thing a phone caller said.
Return ONLY a JSON object with these keys (use null when the caller did not clearly state it):
callerName (string), location (string — the locality of THE CALLER'S property, not a friend's), propertyType (string, e.g. "3BHK apartment", "office", "villa"),
carpetAreaSqft (number), rooms (array of strings), siteCondition (string), referralSource (string).
Never infer or mention prices. Do not guess.`;

const SUMMARY_SYSTEM = `You write a short internal call summary (4–6 sentences) for an Aangan Studio designer.
Plain, factual, third person. Use only facts in the transcript and record. Never include any price, range or per-square-foot figure.
Do not make a qualification decision — it is supplied to you; just restate it.`;

export function templateSummary(fields: EnquiryFields, outcome: string): string {
  const f = fields;
  if (f.complaint) {
    return `${f.callerName ?? "The caller"} called as an existing client with a complaint. Details given: ${f.complaintDetails ?? "not captured"}. The call was escalated for immediate human attention; no commitments were made on the studio's behalf.`;
  }
  const bits: string[] = [];
  bits.push(`${f.callerName ?? "The caller"} enquired about ${f.propertyType ? `a ${f.propertyType}` : f.projectCategory === "commercial" ? "a commercial space" : "a project"}${f.location ? ` in ${f.location}` : ""}${f.carpetAreaSqft ? ` (~${f.carpetAreaSqft.toLocaleString("en-IN")} sq ft carpet)` : ""}.`);
  if (f.rooms?.length) bits.push(`Scope: ${f.rooms.join(", ")}${f.scopeType === "design_and_execution" ? ", design + execution" : ""}.`);
  if (f.siteCondition) bits.push(`Site: ${f.siteCondition}${f.rented ? " (rented — no structural changes)" : ""}.`);
  if (f.timelineText || f.timelineFlexible) bits.push(`Timeline: ${f.timelineText ?? "flexible"}.`);
  if ((f.pricingQuestionCount ?? 0) > 0) bits.push(`Asked about pricing ${f.pricingQuestionCount}× — deflected per policy, no figures given.`);
  if (f.missedCommitment) bits.push("Caller said an earlier enquiry was not followed up — handle with care.");
  bits.push(`Outcome: ${outcome}`);
  return bits.join(" ");
}

class MockProvider implements AIProvider {
  name = "mock" as const;
  live = false;
  constructor(public model = "mock-deterministic") {}
  async extractFields(utterance: string) {
    // The deterministic extractor (extract.ts) already ran; the mock adds nothing.
    return {
      fields: {},
      usage: { inputTokens: estimateTokens(EXTRACT_SYSTEM + utterance), outputTokens: 60, isEstimate: true, note: "Projected — mock mode, no API call" },
    };
  }
  async summarise(transcript: string, fields: EnquiryFields, outcome: string) {
    const text = templateSummary(fields, outcome);
    return {
      text,
      source: "template" as const,
      usage: { inputTokens: estimateTokens(SUMMARY_SYSTEM + transcript), outputTokens: estimateTokens(text), isEstimate: true, note: "Projected — mock mode, no API call" },
    };
  }
}

function parseJsonObject(text: string): Record<string, unknown> {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return {};
  try {
    return JSON.parse(m[0]);
  } catch {
    return {};
  }
}

class AnthropicProvider implements AIProvider {
  name = "anthropic" as const;
  live = true;
  private client: Anthropic;
  constructor(apiKey: string, public model: string) {
    this.client = new Anthropic({ apiKey, timeout: 20_000, maxRetries: 1 });
  }

  private async complete(system: string, user: string, maxTokens: number) {
    // Server-side refusal fallback ("default" routing) so a rare safety decline doesn't break a call.
    const res = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    if (res.stop_reason === "refusal") throw new Error("Model declined the request");
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    return { text, usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens, isEstimate: false } };
  }

  async extractFields(utterance: string, known: EnquiryFields) {
    const ctx = `Already known: ${JSON.stringify({ callerName: known.callerName, location: known.location, propertyType: known.propertyType })}\nCaller said: """${utterance}"""`;
    const { text, usage } = await this.complete(EXTRACT_SYSTEM, ctx, 1024);
    const j = parseJsonObject(text);
    const fields: Partial<EnquiryFields> = {};
    if (typeof j.callerName === "string") fields.callerName = j.callerName;
    if (typeof j.location === "string") fields.location = j.location; // area status is decided deterministically
    if (typeof j.propertyType === "string") fields.propertyType = j.propertyType;
    if (typeof j.carpetAreaSqft === "number" && j.carpetAreaSqft > 50) fields.carpetAreaSqft = j.carpetAreaSqft;
    if (Array.isArray(j.rooms)) fields.rooms = j.rooms.filter((r): r is string => typeof r === "string");
    if (typeof j.siteCondition === "string") fields.siteCondition = j.siteCondition;
    if (typeof j.referralSource === "string") fields.referralSource = j.referralSource;
    return { fields, usage };
  }

  async summarise(transcript: string, fields: EnquiryFields, outcome: string) {
    const { text, usage } = await this.complete(SUMMARY_SYSTEM, `Record: ${JSON.stringify(fields)}\nQualification outcome: ${outcome}\nTranscript:\n${transcript}`, 2048);
    return { text: text.trim(), usage, source: "llm" as const };
  }
}

export function aiStatus(): AIStatus {
  const wanted = (process.env.AI_PROVIDER ?? "mock").toLowerCase();
  const model = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
  if (wanted !== "anthropic") return { provider: "mock", model: "mock-deterministic", live: false, message: "Demo mode: deterministic mock AI (no API calls, no API key needed)." };
  if (!process.env.ANTHROPIC_API_KEY) {
    return { provider: "mock", model: "mock-deterministic", live: false, message: "AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is missing — falling back to mock AI." };
  }
  return { provider: "anthropic", model, live: true, message: `Live AI: Anthropic ${model} (extraction + summaries only).` };
}

export function getAIProvider(): AIProvider {
  const s = aiStatus();
  if (s.live) return new AnthropicProvider(process.env.ANTHROPIC_API_KEY!, s.model);
  return new MockProvider();
}

export const mockProvider = () => new MockProvider();
