/**
 * SMS fallback gateway via Twilio REST API.
 *
 * Used when WhatsApp delivery fails after all retries. Credentials are loaded
 * from environment variables at call time (not at import), so the module is
 * safe to import even when SMS is not configured.
 *
 * Required env vars (only needed when SMS fallback is triggered):
 *   TWILIO_ACCOUNT_SID   — Twilio account SID (ACxxx…)
 *   TWILIO_AUTH_TOKEN    — Twilio auth token
 *   TWILIO_FROM_NUMBER   — Twilio E.164 phone number (e.g. +60xxxxxxxx)
 */

export interface SmsSendResult {
  sid: string;
  status: string;
  to: string;
}

export interface SmsConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
}

/**
 * Load SMS config from environment. Throws if any required variable is missing.
 */
export function loadSmsConfig(): SmsConfig {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    const missing = [
      !accountSid && 'TWILIO_ACCOUNT_SID',
      !authToken && 'TWILIO_AUTH_TOKEN',
      !fromNumber && 'TWILIO_FROM_NUMBER',
    ].filter(Boolean).join(', ');
    throw new Error(`[SmsSender] Missing required env vars: ${missing}`);
  }

  return { accountSid, authToken, fromNumber };
}

/**
 * Send an SMS via Twilio REST API (no SDK dependency — plain HTTP).
 * @param to   Recipient E.164 phone number (e.g. +60xxxxxxxx)
 * @param body Message text (max 1600 chars; longer messages are split by Twilio)
 */
export async function sendSms(to: string, body: string): Promise<SmsSendResult> {
  const { accountSid, authToken, fromNumber } = loadSmsConfig();

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

  const params = new URLSearchParams();
  params.append('To', to);
  params.append('From', fromNumber);
  params.append('Body', body);

  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '(unreadable)');
    throw new Error(
      `[SmsSender] Twilio API error ${response.status}: ${errorBody}`
    );
  }

  const data = (await response.json()) as { sid: string; status: string; to: string };
  return { sid: data.sid, status: data.status, to: data.to };
}

/**
 * Returns true when all Twilio env vars are present (SMS fallback is available).
 */
export function isSmsConfigured(): boolean {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_FROM_NUMBER
  );
}
