/**
 * TOTP 2FA service (US-514).
 *
 * Handles TOTP secret generation, QR-code URI creation, token verification,
 * and AES-256-GCM encryption/decryption of secrets at rest.
 */

import crypto from 'crypto';
import { generateSecret, generateURI, verifySync } from 'otplib';

// ─── Encryption helpers (AES-256-GCM) ───────────────────────────────

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;   // 96-bit IV for GCM

function getEncryptionKey(): Buffer {
  const hex = process.env.TOTP_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('TOTP_ENCRYPTION_KEY must be a 64-char hex string (256-bit key)');
  }
  return Buffer.from(hex, 'hex');
}

/** Encrypt plaintext → "iv:ciphertext:tag" (all hex). */
export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${encrypted.toString('hex')}:${tag.toString('hex')}`;
}

/** Decrypt "iv:ciphertext:tag" (hex) → plaintext. */
export function decryptSecret(blob: string): string {
  const parts = blob.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted blob format');
  const key = getEncryptionKey();
  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = Buffer.from(parts[1], 'hex');
  const tag = Buffer.from(parts[2], 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final('utf8');
}

// ─── TOTP helpers ────────────────────────────────────────────────────

const ISSUER = process.env.TOTP_ISSUER ?? 'Rainbow AI';

/** Generate a new random TOTP secret (base32). */
export function generateTotpSecret(): string {
  return generateSecret();
}

/** Build an otpauth:// URI suitable for QR-code encoding. */
export function buildOtpauthUri(secret: string, accountName: string): string {
  return generateURI({ issuer: ISSUER, label: accountName, secret, type: 'totp' } as any);
}

/**
 * Verify a 6-digit token against a plaintext secret.
 * Allows ±1 time window to account for clock skew.
 */
export function verifyTotp(token: string, secret: string): boolean {
  const result = verifySync({ token, secret, window: 1 } as any);
  return result.valid;
}

// ─── Brute-force tracking (per-user, in-memory) ────────────────────

interface TotpFailRecord {
  count: number;
  windowStart: number;
}

const TOTP_LOCKOUT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const TOTP_MAX_ATTEMPTS = 5;

const totpFailStore = new Map<number, TotpFailRecord>();

/** Record a failed TOTP attempt for a user id. Returns current count. */
export function recordTotpFailure(userId: number, now = Date.now()): number {
  const rec = totpFailStore.get(userId);
  if (!rec || now - rec.windowStart >= TOTP_LOCKOUT_WINDOW_MS) {
    totpFailStore.set(userId, { count: 1, windowStart: now });
    return 1;
  }
  rec.count += 1;
  return rec.count;
}

/** Check if a user is locked out from TOTP attempts. */
export function isTotpLockedOut(userId: number, now = Date.now()): boolean {
  const rec = totpFailStore.get(userId);
  if (!rec) return false;
  if (now - rec.windowStart >= TOTP_LOCKOUT_WINDOW_MS) {
    totpFailStore.delete(userId);
    return false;
  }
  return rec.count >= TOTP_MAX_ATTEMPTS;
}

/** Clear TOTP failure record on successful verification. */
export function clearTotpFailures(userId: number): void {
  totpFailStore.delete(userId);
}
