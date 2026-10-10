import { aiStatus } from "./ai/provider";
import { count, databaseUrlWarning, dbKey } from "./db";
import { emailConfig, emailConfigProblem } from "./email/mailer";
import { integrationStatus } from "./integrations";
import { telephonyStatus } from "./telephony";

export async function systemStatus() {
  const emailProblem = emailConfigProblem();
  const c = emailConfig();
  const demoRows = await count("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM enquiries WHERE is_demo = 1");
  return {
    ai: aiStatus(),
    telephony: telephonyStatus(),
    email: {
      live: !emailProblem,
      message:
        emailProblem ??
        (process.env.RESEND_API_KEY ? `Resend configured. Handoffs to ${c.handoffTo}, escalations to ${c.escalationTo}.` : `SMTP configured (${c.host}). Handoffs to ${c.handoffTo}, escalations to ${c.escalationTo}.`),
    },
    database: dbKey() === "pg" ? "Postgres (Supabase)" : databaseUrlWarning() ? `TEMPORARY demo database — ${databaseUrlWarning()}` : process.env.VERCEL ? "TEMPORARY demo database — set DATABASE_URL in Vercel to use Supabase (data here resets)" : "SQLite (local file)",
    integrations: integrationStatus(),
    demoRows,
  };
}
export type SystemStatus = Awaited<ReturnType<typeof systemStatus>>;
