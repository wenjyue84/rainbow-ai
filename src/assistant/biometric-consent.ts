/**
 * PDPA 2024 Biometric Data Consent Guard (US-994)
 *
 * Malaysia PDPA Amendment Act 2024 Phase 2 (April 2025) classifies facial
 * recognition data from ID photos as biometric data — a sensitive personal
 * data category requiring explicit consent before processing.
 *
 * This module:
 * 1. Maintains a `biometric_consent_records` table with JID hash, consent
 *    status, and timestamp.
 * 2. Provides a guard function `requireBiometricConsent()` that blocks OCR
 *    processing if explicit consent has not been recorded for the JID.
 * 3. Sends a consent-request message when consent is absent.
 * 4. Logs consent events to the security_event_log for auditability.
 *
 * Raw image bytes are NEVER written to the database or disk by the OCR
 * pipeline — only extracted text fields are persisted.
 */
import { pool, dbReady } from '../lib/db.js';
import { hashJid } from './consent.js';
import { logSecurityEvent } from '../lib/security-event-log.js';

// ─── In-memory cache (jid_hash → consent granted) ─────────────────
const biometricConsentCache = new Map<string, boolean>();
let cacheLoaded = false;

// ─── Table bootstrap ──────────────────────────────────────────────
let _tableEnsured = false;

async function ensureBiometricConsentTable(): Promise<void> {
  if (_tableEnsured) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS biometric_consent_records (
        id           BIGSERIAL   PRIMARY KEY,
        jid_hash     TEXT        NOT NULL,
        profile_id   TEXT        NOT NULL DEFAULT 'pelangi',
        consent_granted BOOLEAN  NOT NULL DEFAULT false,
        consent_method  TEXT     NOT NULL DEFAULT 'whatsapp_explicit',
        requested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        responded_at    TIMESTAMPTZ,
        UNIQUE(jid_hash, profile_id)
      );
      CREATE INDEX IF NOT EXISTS idx_biometric_consent_jid_hash
        ON biometric_consent_records(jid_hash);
    `);
    _tableEnsured = true;
  } catch (error) {
    console.error('[BiometricConsent] Failed to ensure table:', error);
  }
}

// ─── Startup: load cache ──────────────────────────────────────────
export async function loadBiometricConsentCache(): Promise<void> {
  try {
    const ready = await dbReady;
    if (!ready) { cacheLoaded = true; return; }
    await ensureBiometricConsentTable();
    const result = await pool.query<{ jid_hash: string; consent_granted: boolean }>(
      'SELECT jid_hash, consent_granted FROM biometric_consent_records'
    );
    biometricConsentCache.clear();
    for (const row of result.rows) {
      biometricConsentCache.set(row.jid_hash, row.consent_granted);
    }
    cacheLoaded = true;
    console.log(`[BiometricConsent] Loaded ${biometricConsentCache.size} records into cache`);
  } catch (error) {
    console.error('[BiometricConsent] Failed to load cache:', error);
    cacheLoaded = true; // Don't block startup
  }
}

// ─── Consent check ────────────────────────────────────────────────

/** Returns true if the JID has explicitly granted biometric data consent. */
export function hasBiometricConsent(phone: string): boolean {
  const hash = hashJid(phone);
  return biometricConsentCache.get(hash) === true;
}

/** Returns true if a consent request is already pending (sent but not yet responded). */
export function hasPendingBiometricConsent(phone: string): boolean {
  const hash = hashJid(phone);
  return biometricConsentCache.has(hash) && biometricConsentCache.get(hash) === false;
}

// ─── Record consent request (pending) ─────────────────────────────

/**
 * Record that a biometric consent request was sent to the JID.
 * Sets consent_granted=false until the guest explicitly agrees.
 */
export async function recordBiometricConsentRequest(
  phone: string,
  profileId: string = 'pelangi'
): Promise<void> {
  const jidHash = hashJid(phone);
  if (biometricConsentCache.has(jidHash)) return; // Already tracked

  try {
    const ready = await dbReady;
    if (!ready) return;
    await ensureBiometricConsentTable();

    await pool.query(
      `INSERT INTO biometric_consent_records (jid_hash, profile_id, consent_granted, consent_method, requested_at)
       VALUES ($1, $2, false, 'whatsapp_explicit', NOW())
       ON CONFLICT (jid_hash, profile_id) DO NOTHING`,
      [jidHash, profileId]
    );
    biometricConsentCache.set(jidHash, false);
    console.log(`[BiometricConsent] Consent request recorded for hash=${jidHash.slice(0, 12)}…`);
  } catch (error) {
    console.error('[BiometricConsent] Failed to record consent request:', error);
  }
}

// ─── Record consent grant ─────────────────────────────────────────

/**
 * Record that the JID has explicitly granted biometric consent.
 * Updates the existing pending record to consent_granted=true with a timestamp.
 */
export async function grantBiometricConsent(
  phone: string,
  profileId: string = 'pelangi'
): Promise<void> {
  const jidHash = hashJid(phone);

  try {
    const ready = await dbReady;
    if (!ready) return;
    await ensureBiometricConsentTable();

    await pool.query(
      `INSERT INTO biometric_consent_records (jid_hash, profile_id, consent_granted, consent_method, requested_at, responded_at)
       VALUES ($1, $2, true, 'whatsapp_explicit', NOW(), NOW())
       ON CONFLICT (jid_hash, profile_id)
       DO UPDATE SET consent_granted = true, responded_at = NOW()`,
      [jidHash, profileId]
    );
    biometricConsentCache.set(jidHash, true);

    // Audit log
    logSecurityEvent({
      adminUser: 'system',
      action: 'biometric_consent_granted',
      resourceType: 'biometric_consent',
      details: {
        jid_hash: jidHash,
        profile_id: profileId,
        legal_reference: 'PDPA Amendment Act 2024 Phase 2 — biometric data explicit consent',
      },
    }).catch(() => {});

    console.log(`[BiometricConsent] Consent GRANTED for profile=${profileId} hash=${jidHash.slice(0, 12)}…`);
  } catch (error) {
    console.error('[BiometricConsent] Failed to grant consent:', error);
  }
}

// ─── Consent revocation ───────────────────────────────────────────

/**
 * Revoke biometric consent for a JID (right to withdraw).
 */
export async function revokeBiometricConsent(
  phone: string,
  profileId: string = 'pelangi'
): Promise<void> {
  const jidHash = hashJid(phone);

  try {
    const ready = await dbReady;
    if (!ready) return;

    await pool.query(
      `UPDATE biometric_consent_records
       SET consent_granted = false, responded_at = NOW()
       WHERE jid_hash = $1 AND profile_id = $2`,
      [jidHash, profileId]
    );
    biometricConsentCache.set(jidHash, false);

    logSecurityEvent({
      adminUser: 'system',
      action: 'biometric_consent_revoked',
      resourceType: 'biometric_consent',
      details: {
        jid_hash: jidHash,
        profile_id: profileId,
        legal_reference: 'PDPA 2024 — right to withdraw consent for sensitive data processing',
      },
    }).catch(() => {});

    console.log(`[BiometricConsent] Consent REVOKED for profile=${profileId} hash=${jidHash.slice(0, 12)}…`);
  } catch (error) {
    console.error('[BiometricConsent] Failed to revoke consent:', error);
  }
}

// ─── Consent request message builder ──────────────────────────────

export interface BiometricConsentMessages {
  en: string;
  ms: string;
  zh: string;
}

/**
 * Build a consent request message in the detected language.
 * Explains PDPA requirements and asks for explicit YES/NO.
 */
export function buildConsentRequestMessage(lang: 'en' | 'ms' | 'zh' | 'ta' = 'en'): string {
  const messages: Record<string, string> = {
    en: [
      '*Biometric Data Consent Required*',
      '',
      'Under Malaysia\'s Personal Data Protection Act 2024, facial images on identity documents (passport/IC photos) are classified as *biometric data* — a sensitive personal data category.',
      '',
      'Before we can process your ID document image, we need your *explicit consent*.',
      '',
      'Your ID image will be:',
      '• Processed in-memory only (NOT saved to our servers)',
      '• Sent to a secure OCR service to extract text fields only',
      '• Immediately discarded after text extraction',
      '',
      'Only the extracted text (name, ID number, nationality) will be stored.',
      '',
      'Reply *YES* to consent, or *NO* to decline.',
      'You may withdraw consent at any time by contacting us.',
    ].join('\n'),
    ms: [
      '*Persetujuan Data Biometrik Diperlukan*',
      '',
      'Di bawah Akta Perlindungan Data Peribadi Malaysia 2024, imej muka pada dokumen pengenalan (foto pasport/IC) diklasifikasikan sebagai *data biometrik* — kategori data peribadi sensitif.',
      '',
      'Sebelum kami memproses imej dokumen pengenalan anda, kami memerlukan *persetujuan jelas* anda.',
      '',
      'Imej ID anda akan:',
      '• Diproses dalam memori sahaja (TIDAK disimpan di pelayan kami)',
      '• Dihantar ke perkhidmatan OCR selamat untuk mengekstrak teks sahaja',
      '• Dibuang serta-merta selepas pengekstrakan teks',
      '',
      'Hanya teks yang diekstrak (nama, nombor ID, kewarganegaraan) akan disimpan.',
      '',
      'Balas *YA* untuk bersetuju, atau *TIDAK* untuk menolak.',
      'Anda boleh menarik balik persetujuan pada bila-bila masa.',
    ].join('\n'),
    zh: [
      '*需要生物识别数据同意*',
      '',
      '根据马来西亚2024年个人数据保护法，身份证件上的面部图像（护照/IC照片）被归类为*生物识别数据*——属于敏感个人数据类别。',
      '',
      '在我们处理您的身份证件图像之前，我们需要您的*明确同意*。',
      '',
      '您的证件图像将：',
      '• 仅在内存中处理（不会保存到我们的服务器）',
      '• 发送到安全的OCR服务仅提取文字',
      '• 文字提取后立即丢弃',
      '',
      '仅提取的文字（姓名、证件号码、国籍）会被存储。',
      '',
      '回复 *YES* 同意，或 *NO* 拒绝。',
      '您可以随时联系我们撤回同意。',
    ].join('\n'),
  };
  // Tamil falls back to English
  return messages[lang] ?? messages.en;
}

// ─── Consent response keywords ────────────────────────────────────

const CONSENT_YES_KEYWORDS = ['yes', 'ya', 'agree', 'setuju', 'ok', 'okay', 'y', 'confirm', 'sahkan'];
const CONSENT_NO_KEYWORDS = ['no', 'tidak', 'decline', 'tolak', 'n', 'nope', 'refuse'];

export function isBiometricConsentYes(text: string): boolean {
  return CONSENT_YES_KEYWORDS.includes(text.toLowerCase().trim());
}

export function isBiometricConsentNo(text: string): boolean {
  return CONSENT_NO_KEYWORDS.includes(text.toLowerCase().trim());
}

// ─── OCR Guard ────────────────────────────────────────────────────

export interface BiometricGuardResult {
  allowed: boolean;
  reason: 'consent_granted' | 'consent_pending' | 'consent_requested' | 'consent_declined' | 'disabled';
  consentMessage?: string;
}

/**
 * Guard function for OCR image processing.
 *
 * Call this BEFORE sending any ID image to an external OCR provider.
 * If consent is not on record, returns `allowed: false` with a consent
 * request message to send to the guest.
 *
 * The caller MUST NOT persist raw image bytes to disk or database,
 * regardless of the consent outcome.
 *
 * @param phone - Guest WhatsApp JID
 * @param lang - Detected language for the consent message
 * @param profileId - Profile for multi-tenant consent tracking
 * @param enabled - Whether biometric consent is enabled (from settings)
 */
export async function requireBiometricConsent(
  phone: string,
  lang: 'en' | 'ms' | 'zh' | 'ta' = 'en',
  profileId: string = 'pelangi',
  enabled: boolean = true
): Promise<BiometricGuardResult> {
  // Feature toggle — if disabled, allow all OCR without consent
  if (!enabled) {
    return { allowed: true, reason: 'disabled' };
  }

  // Check cache for existing consent
  if (hasBiometricConsent(phone)) {
    return { allowed: true, reason: 'consent_granted' };
  }

  // Already pending — remind guest
  if (hasPendingBiometricConsent(phone)) {
    return {
      allowed: false,
      reason: 'consent_pending',
      consentMessage: buildConsentRequestMessage(lang),
    };
  }

  // No consent record at all — create pending and send request
  await recordBiometricConsentRequest(phone, profileId);
  return {
    allowed: false,
    reason: 'consent_requested',
    consentMessage: buildConsentRequestMessage(lang),
  };
}

/**
 * Handle a guest's response to a biometric consent request.
 *
 * Returns a reply message to send back to the guest.
 */
export async function handleBiometricConsentResponse(
  phone: string,
  text: string,
  lang: 'en' | 'ms' | 'zh' | 'ta' = 'en',
  profileId: string = 'pelangi'
): Promise<{ handled: boolean; reply?: string }> {
  // Only process if there's a pending consent request
  if (!hasPendingBiometricConsent(phone)) {
    return { handled: false };
  }

  if (isBiometricConsentYes(text)) {
    await grantBiometricConsent(phone, profileId);
    const replies: Record<string, string> = {
      en: 'Thank you for your consent. You may now send your ID document image for processing. Your image will be processed in-memory only and immediately discarded after text extraction.',
      ms: 'Terima kasih atas persetujuan anda. Anda kini boleh menghantar imej dokumen pengenalan untuk diproses. Imej akan diproses dalam memori sahaja dan dibuang serta-merta selepas pengekstrakan teks.',
      zh: '感谢您的同意。您现在可以发送身份证件图像进行处理。图像将仅在内存中处理，文字提取后立即丢弃。',
    };
    return { handled: true, reply: replies[lang] ?? replies.en };
  }

  if (isBiometricConsentNo(text)) {
    // Leave as pending=false (declined); don't delete the record for audit trail
    const replies: Record<string, string> = {
      en: 'Understood. Your ID image will not be processed. You can manually enter your details instead, or contact our staff for assistance.',
      ms: 'Difahami. Imej ID anda tidak akan diproses. Anda boleh memasukkan butiran secara manual, atau hubungi staf kami untuk bantuan.',
      zh: '明白。您的证件图像将不会被处理。您可以手动输入详情，或联系我们的工作人员寻求帮助。',
    };
    return { handled: true, reply: replies[lang] ?? replies.en };
  }

  return { handled: false };
}

// ─── Admin API helper ─────────────────────────────────────────────

/**
 * Get biometric consent record for admin lookup.
 */
export async function getBiometricConsentByJid(phone: string): Promise<{
  jid_hash: string;
  profile_id: string;
  consent_granted: boolean;
  consent_method: string;
  requested_at: Date;
  responded_at: Date | null;
} | null> {
  const jidHash = hashJid(phone);
  try {
    const result = await pool.query<{
      jid_hash: string;
      profile_id: string;
      consent_granted: boolean;
      consent_method: string;
      requested_at: Date;
      responded_at: Date | null;
    }>(
      `SELECT jid_hash, profile_id, consent_granted, consent_method, requested_at, responded_at
       FROM biometric_consent_records
       WHERE jid_hash = $1
       LIMIT 1`,
      [jidHash]
    );
    return result.rows[0] ?? null;
  } catch (error) {
    console.error('[BiometricConsent] Admin lookup failed:', error);
    return null;
  }
}
