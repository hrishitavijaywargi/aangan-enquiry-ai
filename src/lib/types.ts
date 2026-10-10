export type EnquiryStatus = "in_progress" | "qualified" | "not_qualified" | "awaiting_info" | "escalated";
export type EnquiryType = "residential" | "commercial" | "complaint" | "unknown";

export type ScopeType =
  | "design_and_execution"
  | "advice_only"
  | "design_only"
  | "styling_only"
  | "furniture_only"
  | "vastu_only"
  | "structural";

export type DecisionMaker =
  | "self"
  | "joint_owner_confirmed"
  | "authorised_representative"
  | "representing_attending" // calling for decision-makers who will attend the consultation
  | "not_authorised"
  | "unknown";

export type LocationStatus = "in_area" | "out_of_area" | "unclear";

/** Structured enquiry record collected during the call. */
export interface EnquiryFields {
  callerName?: string;
  phoneConfirmed?: boolean;
  email?: string;
  projectCategory?: "residential" | "commercial";
  propertyType?: string; // e.g. "3BHK apartment", "office", "villa"
  outOfScopeType?: string; // e.g. "restaurant"
  location?: string;
  locationStatus?: LocationStatus;
  carpetAreaSqft?: number;
  rooms?: string[];
  scopeType?: ScopeType;
  scopeSignal?: "strong" | "weak";
  earlyStage?: boolean;
  siteCondition?: string;
  rented?: boolean;
  structuralRequest?: boolean;
  siteAvailableInWeeks?: number;
  timelineText?: string;
  requiredByDate?: string; // ISO date the project must be complete by
  timelineFlexible?: boolean;
  startText?: string;
  budgetText?: string;
  budgetMaxInr?: number;
  budgetMentionedNoFigure?: boolean;
  decisionMaker?: DecisionMaker;
  decisionText?: string;
  referralSource?: string;
  consultationRequested?: boolean;
  preferredSlot?: string;
  complaint?: boolean;
  complaintDetails?: string;
  missedCommitment?: boolean;
  pricingQuestionCount?: number;
  declined?: QuestionKey[]; // questions the caller chose not to answer
}

export type QuestionKey =
  | "need"
  | "name"
  | "location"
  | "location_confirm"
  | "rooms"
  | "execution"
  | "property"
  | "site"
  | "timeline"
  | "decision"
  | "contact"
  | "referral"
  | "consultation"
  | "complaint_details"
  | "anything_else";

export type CriterionStatus = "pass" | "fail" | "unclear" | "assumed_pass";

export interface CriterionResult {
  id: 1 | 2 | 3 | 4 | 5;
  name: string;
  status: CriterionStatus;
  reason: string;
  evidence: string[];
}

export type QualificationDecision =
  | "qualified"
  | "not_qualified" // exactly one criterion failed → close gracefully
  | "declined" // two or more failed → decline gracefully
  | "needs_clarification" // 1, 2 or 3 unclear
  | "not_applicable"; // complaint / existing client

export interface QualificationResult {
  decision: QualificationDecision;
  criteria: CriterionResult[];
  failed: number[];
  unclear: number[];
  uncertainties: string[];
  summary: string;
}

export type AgentPhase = "greeting" | "collecting" | "closing" | "ended";

export interface AgentState {
  phase: AgentPhase;
  turn: number;
  asked: Partial<Record<QuestionKey, number>>;
  lastQuestion?: QuestionKey;
  intent: "new_enquiry" | "complaint" | "unknown";
  closeReason?: "qualified" | "not_qualified" | "declined" | "awaiting_info" | "escalated";
  evidence: Partial<Record<string, string>>; // field → caller quote that established it
  questionsAsked: string[];
}

export interface TranscriptMessage {
  role: "agent" | "caller" | "system";
  text: string;
  at: string; // ISO
  tags?: string[];
}

export interface Settings {
  officeStartHour: number;
  officeEndHour: number;
  workingDays: number[];
  dedupeWindowDays: number;
  expectedMonthlyEnquiries: number;
  usdToInr: number;
  aiInputUsdPerMTok: number;
  aiOutputUsdPerMTok: number;
  telephonyInrPerMinute: number;
  emailInrPerMessage: number;
  recurring: { label: string; inrPerMonth: number }[];
  festivalDates: Record<string, string>; // e.g. { diwali: "2026-11-08" }
  autoSendHandoffs: boolean;
}
