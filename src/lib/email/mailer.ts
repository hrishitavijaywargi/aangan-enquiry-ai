/**
 * Email delivery for handoff notes.
 *  - SMTP configured  → really sends via nodemailer; status "sent" only after the server accepts it.
 *  - SMTP missing     → saves an .eml file to data/outbox (openable in any mail client);
 *                       status "saved_locally" with an explicit "not sent" reason. Never reported as sent.
 */
import fs from "node:fs";
import path from "node:path";
import nodemailer from "nodemailer";

export interface EmailMessage {
  id: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  urgent?: boolean;
}

export interface SendResult {
  status: "sent" | "saved_locally" | "failed";
  provider: string;
  sentAt?: string;
  emlPath?: string;
  error?: string;
}

export function emailConfig() {
  return {
    host: process.env.SMTP_HOST?.trim() || "",
    port: Number(process.env.SMTP_PORT || 587),
    secure: (process.env.SMTP_SECURE || "false") === "true",
    user: process.env.SMTP_USER?.trim() || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.EMAIL_FROM || "Aangan Studio Enquiries <enquiries@example.com>",
    handoffTo: process.env.HANDOFF_EMAIL_TO || "designers@example.com",
    escalationTo: process.env.ESCALATION_EMAIL_TO || "studio-head@example.com",
  };
}

/** Returns null when sending is possible, otherwise the reason it is not. */
export function emailConfigProblem(): string | null {
  const c = emailConfig();
  if (!c.host) return "SMTP_HOST is not set — email credentials are not configured, so handoffs are saved locally and NOT sent.";
  if (c.user && !c.pass) return "SMTP_USER is set but SMTP_PASS is missing — cannot authenticate.";
  return null;
}

export function outboxDir() {
  return process.env.AANGAN_OUTBOX_DIR ?? path.join(process.cwd(), "data", "outbox");
}

async function buildEml(msg: EmailMessage, from: string): Promise<Buffer> {
  const t = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
  const info = await t.sendMail({ from, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html, priority: msg.urgent ? "high" : "normal" });
  return info.message as Buffer;
}

export async function saveLocally(msg: EmailMessage, reason: string): Promise<SendResult> {
  const c = emailConfig();
  const dir = outboxDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${msg.id}.eml`);
  fs.writeFileSync(file, await buildEml(msg, c.from));
  return { status: "saved_locally", provider: "local-outbox", emlPath: file, error: reason };
}

export async function sendEmail(msg: EmailMessage): Promise<SendResult> {
  const problem = emailConfigProblem();
  if (problem) return saveLocally(msg, problem);
  const c = emailConfig();
  try {
    const transport = nodemailer.createTransport({
      host: c.host,
      port: c.port,
      secure: c.secure,
      auth: c.user ? { user: c.user, pass: c.pass } : undefined,
    });
    await transport.sendMail({ from: c.from, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html, priority: msg.urgent ? "high" : "normal" });
    return { status: "sent", provider: `smtp:${c.host}`, sentAt: new Date().toISOString() };
  } catch (e) {
    const local = await saveLocally(msg, `SMTP send failed: ${(e as Error).message}`);
    return { ...local, status: "failed" };
  }
}
