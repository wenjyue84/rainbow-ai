/**
 * PII Field Encryption (US-968)
 *
 * Provides AES-256-GCM encryption and decryption for PII fields stored in the
 * database (guest names, phone numbers, booking data), fulfilling Malaysia PDPA
 * 2024 Security Principle obligations for data processors.
 *
 * Encrypted format: "v1:<iv_hex>:<ciphertext_hex>:<tag_hex>"
 * - v1 prefix enables algorithm migration without breaking stored values
 * - 96-bit IV (GCM recommendation) re-randomized per encryption
 * - 128-bit auth tag ensures integrity + authenticity
 *
 * Key management:
 *   PII_ENCRYPTION_KEY env var — 64-char hex string (256-bit key)
 *   If not set, encryption is skipped and plaintext is stored (dev mode).
 *   Production deployments MUST set this variable.
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm' as const;
const IV_LENGTH = 12;   // 96-bit IV for GCM
const PREFIX = 'v1:';

// ─── Key Management ──────────────────────────────────────────────────

let _key: Buffer | null = null;

function getKey(): Buffer | null {
  if (_key !== null) return _key;
  const hex = process.env.PII_ENCRYPTION_KEY;
  if (!hex) return null;           // dev mode — no encryption
  if (hex.length !== 64) {
    console.error('[PiiEncryption] PII_ENCRYPTION_KEY must be a 64-char hex string (256 bits). PII encryption is DISABLED.');
    return null;
  }
  _key = Buffer.from(hex, 'hex');
  return _key;
}

/** Returns true when PII encryption is active (key configured). */
export function isPiiEncryptionEnabled(): boolean {
  return getKey() !== null;
}

// ─── Core Encrypt / Decrypt ──────────────────────────────────────────

/**
 * Encrypt a plaintext PII value using AES-256-GCM.
 * Returns the ciphertext blob or the original plaintext if encryption is
 * not configured (dev mode).
 */
export function encryptPii(plaintext: string): string {
  if (!plaintext) return plaintext;

  const key = getKey();
  if (!key) return plaintext;            // dev mode passthrough

  // Already encrypted — idempotent
  if (plaintext.startsWith(PREFIX)) return plaintext;

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('hex')}:${encrypted.toString('hex')}:${tag.toString('hex')}`;
}

/**
 * Decrypt a PII blob encrypted by encryptPii().
 * Returns the original plaintext.  Throws if the blob is malformed or
 * tampered with.
 */
export function decryptPii(blob: string): string {
  if (!blob) return blob;
  if (!blob.startsWith(PREFIX)) return blob;   // plaintext passthrough

  const key = getKey();
  if (!key) {
    throw new Error('[PiiEncryption] Cannot decrypt: PII_ENCRYPTION_KEY is not configured');
  }

  const inner = blob.slice(PREFIX.length);
  const parts = inner.split(':');
  if (parts.length !== 3) throw new Error('[PiiEncryption] Invalid encrypted PII blob format');

  const [ivHex, ctHex, tagHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const ct = Buffer.from(ctHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ct).toString('utf8') + decipher.final('utf8');
}

// ─── Batch Helpers ───────────────────────────────────────────────────

/** Encrypt all string values in a record whose keys match a PII field list. */
export function encryptPiiFields<T extends Record<string, unknown>>(
  record: T,
  fields: (keyof T)[],
): T {
  const out = { ...record };
  for (const field of fields) {
    const val = out[field];
    if (typeof val === 'string') {
      (out as Record<string, unknown>)[field as string] = encryptPii(val);
    }
  }
  return out;
}

/** Decrypt all string values in a record whose keys match a PII field list. */
export function decryptPiiFields<T extends Record<string, unknown>>(
  record: T,
  fields: (keyof T)[],
): T {
  const out = { ...record };
  for (const field of fields) {
    const val = out[field];
    if (typeof val === 'string') {
      (out as Record<string, unknown>)[field as string] = decryptPii(val);
    }
  }
  return out;
}

// ─── Standard PII Fields ─────────────────────────────────────────────

/**
 * The canonical list of PII fields in Rainbow AI database rows.
 * Used for RBAC gate documentation and batch encrypt/decrypt helpers.
 */
export const PII_FIELDS = [
  'phone',
  'phone_number',
  'guest_name',
  'name',
  'email',
  'ic_number',
  'passport_number',
] as const;

export type PiiField = typeof PII_FIELDS[number];
