import { aiStatus } from "./ai/provider";
import { getDb } from "./db";
import { emailConfig, emailConfigProblem } from "./email/mailer";
import { telephonyStatus } from "./telephony";

export function systemStatus() {
  const emailProblem = emailConfigProblem();
  const demoRows = (getDb().prepare("SELECT COUNT(*) AS n FROM enquiries WHERE is_demo = 1").get() as { n: number }).n;
  return {
    ai: aiStatus(),
    telephony: telephonyStatus(),
    email: {
      live: !emailProblem,
      message: emailProblem ?? `SMTP configured (${emailConfig().host}). Handoffs to ${emailConfig().handoffTo}, escalations to ${emailConfig().escalationTo}.`,
    },
    demoRows,
  };
}
export type SystemStatus = ReturnType<typeof systemStatus>;
