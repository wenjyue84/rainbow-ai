/**
 * Message sender with WhatsApp → SMS fallback (US-347).
 *
 * Wraps a SendMessageFn with:
 *   1. Exponential-backoff retry (up to maxAttempts via withSendRetry)
 *   2. SMS fallback via Twilio when all WhatsApp attempts are exhausted
 *
 * The SMS fallback is triggered only when:
 *   - All WhatsApp retries are exhausted (default: 3 attempts = 2 retries)
 *   - The TWILIO_* env vars are configured (otherwise falls through and re-throws)
 *
 * Usage:
 *   const send = withSmsFallback(rawSendFn);
 *   await send(phone, text, instanceId);
 */
import type { SendMessageFn } from '../types.js';
import { withSendRetry } from '../../lib/send-retry.js';
import { sendSms, isSmsConfigured } from '../../lib/sms-sender.js';

interface FallbackOptions {
  /** Max WhatsApp send attempts (default: 3 → retries twice before fallback) */
  maxAttempts?: number;
  baseDelayMs?: number;
}

/**
 * Wraps a SendMessageFn: retries WhatsApp delivery, then falls back to SMS.
 */
export function withSmsFallback(
  send: SendMessageFn,
  opts?: FallbackOptions
): SendMessageFn {
  const wrapped = withSendRetry(send, {
    maxAttempts: opts?.maxAttempts ?? 3,
    baseDelayMs: opts?.baseDelayMs,
  });

  return async (phone: string, text: string, instanceId?: string) => {
    try {
      return await wrapped(phone, text, instanceId);
    } catch (whatsAppErr: any) {
      // WhatsApp failed after all retries — attempt SMS fallback
      if (!isSmsConfigured()) {
        console.error(
          `[MessageSender] WhatsApp delivery failed and SMS is not configured. ` +
          `Message to ${phone} lost. Error: ${whatsAppErr.message}`
        );
        throw whatsAppErr;
      }

      console.warn(
        `[MessageSender] WhatsApp delivery failed for ${phone} after all retries. ` +
        `Falling back to SMS via Twilio.`
      );

      try {
        const result = await sendSms(phone, text);
        console.log(
          `[MessageSender] SMS fallback succeeded for ${phone} — SID: ${result.sid}, status: ${result.status}`
        );
        return result;
      } catch (smsErr: any) {
        console.error(
          `[MessageSender] SMS fallback also failed for ${phone}: ${smsErr.message}`
        );
        // Throw the original WhatsApp error with SMS error context
        throw new Error(
          `WhatsApp delivery failed (${whatsAppErr.message}); SMS fallback also failed (${smsErr.message})`
        );
      }
    }
  };
}
