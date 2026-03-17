/**
 * DPO Email Notification (US-020)
 *
 * Sends email to the Data Protection Officer when a data breach is detected.
 * Malaysia PDPA Amendment Act 2024 — 72-hour notification requirement.
 *
 * Email delivery strategy:
 *   1. If SMTP_HOST + SMTP_USER + SMTP_PASS env vars are set → send via SMTP
 *   2. If EMAIL_WEBHOOK_URL is set → POST JSON payload to webhook relay
 *   3. Otherwise → log the email content (fallback, no delivery)
 *
 * Tests mock this module's `sendDpoBreachEmail` directly.
 */

import { createModuleLogger } from './logger.js';

const logger = createModuleLogger('DpoEmail');

export interface BreachEmailPayload {
  incidentId: string;
  breachType: string;
  detectedAt: Date;
  estimatedAffected: number;
  dataCategories: string[];
  description: string;
  dpoEmail: string;
  commissionerDeadline: Date;
}

/** Format date in MYT for human-readable email body */
function fmtMyt(d: Date): string {
  return d.toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' });
}

/** Build plain-text email body for PDPA breach notification */
function buildEmailBody(payload: BreachEmailPayload): string {
  const remainingHours = Math.max(
    0,
    Math.round((payload.commissionerDeadline.getTime() - Date.now()) / 3_600_000),
  );
  return [
    `PDPA DATA BREACH NOTIFICATION`,
    ``,
    `Incident ID  : ${payload.incidentId}`,
    `Breach Type  : ${payload.breachType}`,
    `Detected At  : ${fmtMyt(payload.detectedAt)} (MYT)`,
    `Affected Est.: ${payload.estimatedAffected} individuals`,
    `Data Categories: ${payload.dataCategories.join(', ') || 'Unknown'}`,
    ``,
    `Description:`,
    payload.description,
    ``,
    `REGULATORY DEADLINE`,
    `Commissioner notification due: ${fmtMyt(payload.commissionerDeadline)} (${remainingHours}h remaining)`,
    ``,
    `REQUIRED ACTIONS`,
    `1. Assess the breach scope and document findings`,
    `2. File notification with PDPC Commissioner via: https://www.pdp.gov.my`,
    `3. Mark as acknowledged via Admin Panel: PATCH /api/rainbow/security/breach-incidents/${payload.incidentId}/acknowledge`,
    `4. Notify affected individuals within 7 days if significant harm likely`,
    ``,
    `This notification was generated automatically by Rainbow AI breach detection.`,
    `Malaysia PDPA Amendment Act 2024 — Section 12C (Mandatory Breach Notification)`,
  ].join('\n');
}

/** Send breach notification email via SMTP using env-configured credentials */
async function sendViaSMTP(to: string, subject: string, body: string): Promise<void> {
  const { createTransport } = await import('nodemailer');
  const transporter = createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to,
    subject,
    text: body,
  });
}

/** Send breach notification email via HTTP webhook relay */
async function sendViaWebhook(to: string, subject: string, body: string): Promise<void> {
  const webhookUrl = process.env.EMAIL_WEBHOOK_URL!;
  const resp = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to, subject, body }),
  });
  if (!resp.ok) {
    throw new Error(`Webhook email relay returned ${resp.status}: ${await resp.text()}`);
  }
}

/**
 * Send PDPA breach notification email to the DPO.
 *
 * Returns `true` if delivery was attempted (SMTP or webhook), `false` if
 * no transport is configured (email is logged only).
 */
export async function sendDpoBreachEmail(payload: BreachEmailPayload): Promise<boolean> {
  const subject = `[URGENT] PDPA Data Breach Notification — Incident ${payload.incidentId}`;
  const body = buildEmailBody(payload);

  const hasSmtp = process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS;
  const hasWebhook = !!process.env.EMAIL_WEBHOOK_URL;

  if (hasSmtp) {
    try {
      await sendViaSMTP(payload.dpoEmail, subject, body);
      logger.info('DPO breach email sent via SMTP', { to: payload.dpoEmail, incidentId: payload.incidentId });
      return true;
    } catch (err: any) {
      logger.error('SMTP send failed, falling back to webhook', { error: err.message });
    }
  }

  if (hasWebhook) {
    try {
      await sendViaWebhook(payload.dpoEmail, subject, body);
      logger.info('DPO breach email sent via webhook', { to: payload.dpoEmail, incidentId: payload.incidentId });
      return true;
    } catch (err: any) {
      logger.error('Webhook email send failed', { error: err.message });
    }
  }

  // Fallback: log the email content so it can be reviewed manually
  logger.warn('No email transport configured — DPO email logged only', {
    to: payload.dpoEmail,
    subject,
    incidentId: payload.incidentId,
    emailBody: body,
  });
  return false;
}
