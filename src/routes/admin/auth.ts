/**
 * Admin 2FA Auth routes (US-514).
 *
 * Endpoints:
 *   POST /auth/register     — Create admin user (requires admin key)
 *   POST /auth/setup-2fa    — Generate TOTP secret + QR URI (requires admin key)
 *   POST /auth/verify-setup — Confirm TOTP enrolment with a valid token
 *   POST /auth/login        — Username + password login; returns 2FA challenge if enabled
 *   POST /auth/verify-totp  — Complete login by providing a valid TOTP token
 *   POST /auth/disable-2fa  — Disable 2FA (requires password + current TOTP)
 *   GET  /auth/status/:username — Check if 2FA is enabled for a user
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { adminUsers, ADMIN_ROLES } from '../../../shared/schema.js';
import type { AdminRole } from '../../../shared/schema.js';
import {
  generateTotpSecret,
  buildOtpauthUri,
  verifyTotp,
  encryptSecret,
  decryptSecret,
  recordTotpFailure,
  isTotpLockedOut,
  clearTotpFailures,
} from '../../lib/totp-service.js';

const router = Router();

// ─── Helpers ────────────────────────────────────────────────────────

/** Hash password with scrypt (128-bit salt, 64-byte key). */
async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = await new Promise<Buffer>((resolve, reject) =>
    crypto.scrypt(password, salt, 64, (err, derivedKey) =>
      err ? reject(err) : resolve(derivedKey)
    )
  );
  return `${salt}:${key.toString('hex')}`;
}

/** Verify password against stored hash. */
async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const key = await new Promise<Buffer>((resolve, reject) =>
    crypto.scrypt(password, salt, 64, (err, derivedKey) =>
      err ? reject(err) : resolve(derivedKey)
    )
  );
  const storedBuf = Buffer.from(hash, 'hex');
  const derivedBuf = key;
  if (storedBuf.length !== derivedBuf.length) return false;
  return crypto.timingSafeEqual(storedBuf, derivedBuf);
}

// Pending 2FA setup secrets: userId -> plaintext secret (ephemeral, not yet saved)
const pendingSetups = new Map<number, { secret: string; expiresAt: number }>();
// Pending 2FA login challenges: challengeToken -> { userId, expiresAt }
const pendingChallenges = new Map<string, { userId: number; expiresAt: number }>();

// Clean up expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendingSetups) {
    if (now > v.expiresAt) pendingSetups.delete(k);
  }
  for (const [k, v] of pendingChallenges) {
    if (now > v.expiresAt) pendingChallenges.delete(k);
  }
}, 60_000).unref();

// ─── POST /auth/register ────────────────────────────────────────────
// Creates an admin user. Protected by admin key (inherited from parent middleware).

router.post('/auth/register', async (req: Request, res: Response) => {
  try {
    const { username, password, role: rawRole } = req.body ?? {};
    if (!username || typeof username !== 'string' || username.length < 3) {
      res.status(400).json({ error: 'username must be at least 3 characters' });
      return;
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
      res.status(400).json({ error: 'password must be at least 8 characters' });
      return;
    }

    // US-898: validate role (defaults to 'viewer' if omitted)
    const role: AdminRole = (rawRole && ADMIN_ROLES.includes(rawRole)) ? rawRole : 'viewer';

    const existing = await db.select({ id: adminUsers.id })
      .from(adminUsers)
      .where(eq(adminUsers.username, username))
      .limit(1);
    if (existing.length > 0) {
      res.status(409).json({ error: 'Username already exists' });
      return;
    }

    const passwordHash = await hashPassword(password);
    const [user] = await db.insert(adminUsers).values({
      username,
      passwordHash,
      role,
    }).returning({ id: adminUsers.id, username: adminUsers.username });

    res.status(201).json({ id: user.id, username: user.username, role, totpEnabled: false });
  } catch (err) {
    console.error('[auth/register]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /auth/setup-2fa ───────────────────────────────────────────
// Generates a TOTP secret and returns the otpauth URI for QR code display.
// Requires { username, password } to authenticate the admin first.

router.post('/auth/setup-2fa', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body ?? {};
    if (!username || !password) {
      res.status(400).json({ error: 'username and password required' });
      return;
    }

    const [user] = await db.select()
      .from(adminUsers)
      .where(eq(adminUsers.username, username))
      .limit(1);
    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    if (user.totpEnabled) {
      res.status(400).json({ error: '2FA is already enabled. Disable it first to re-enrol.' });
      return;
    }

    const secret = generateTotpSecret();
    const otpauthUri = buildOtpauthUri(secret, username);

    // Store temporarily until verify-setup confirms it
    pendingSetups.set(user.id, { secret, expiresAt: Date.now() + 10 * 60_000 }); // 10 min

    res.json({ otpauthUri, secret }); // secret shown for manual entry; URI for QR
  } catch (err) {
    console.error('[auth/setup-2fa]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /auth/verify-setup ────────────────────────────────────────
// Confirms 2FA enrolment by verifying a TOTP token against the pending secret.

router.post('/auth/verify-setup', async (req: Request, res: Response) => {
  try {
    const { username, password, token } = req.body ?? {};
    if (!username || !password || !token) {
      res.status(400).json({ error: 'username, password, and token required' });
      return;
    }

    const [user] = await db.select()
      .from(adminUsers)
      .where(eq(adminUsers.username, username))
      .limit(1);
    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const pending = pendingSetups.get(user.id);
    if (!pending || Date.now() > pending.expiresAt) {
      pendingSetups.delete(user.id);
      res.status(400).json({ error: 'No pending 2FA setup. Call setup-2fa first.' });
      return;
    }

    if (!verifyTotp(token, pending.secret)) {
      res.status(400).json({ error: 'Invalid TOTP token. Please try again.' });
      return;
    }

    // Encrypt and persist the secret
    const encrypted = encryptSecret(pending.secret);
    await db.update(adminUsers)
      .set({ totpSecret: encrypted, totpEnabled: true, updatedAt: new Date() })
      .where(eq(adminUsers.id, user.id));

    pendingSetups.delete(user.id);
    res.json({ success: true, message: '2FA enabled successfully' });
  } catch (err) {
    console.error('[auth/verify-setup]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /auth/login ───────────────────────────────────────────────
// Username + password check. If 2FA is enabled, returns a challenge token
// that must be completed via /auth/verify-totp.

router.post('/auth/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body ?? {};
    if (!username || !password) {
      res.status(400).json({ error: 'username and password required' });
      return;
    }

    const [user] = await db.select()
      .from(adminUsers)
      .where(eq(adminUsers.username, username))
      .limit(1);
    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    if (!user.totpEnabled) {
      // No 2FA — login complete
      res.json({ authenticated: true, requires2fa: false, username: user.username, role: user.role });
      return;
    }

    // 2FA required — issue a time-limited challenge token
    const challengeToken = crypto.randomBytes(32).toString('hex');
    pendingChallenges.set(challengeToken, {
      userId: user.id,
      expiresAt: Date.now() + 5 * 60_000, // 5 minutes to provide TOTP
    });

    res.json({ authenticated: false, requires2fa: true, challengeToken });
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /auth/verify-totp ─────────────────────────────────────────
// Complete 2FA login by providing the challenge token + 6-digit TOTP.

router.post('/auth/verify-totp', async (req: Request, res: Response) => {
  try {
    const { challengeToken, token } = req.body ?? {};
    if (!challengeToken || !token) {
      res.status(400).json({ error: 'challengeToken and token required' });
      return;
    }

    const challenge = pendingChallenges.get(challengeToken);
    if (!challenge || Date.now() > challenge.expiresAt) {
      pendingChallenges.delete(challengeToken);
      res.status(401).json({ error: 'Challenge expired. Please login again.' });
      return;
    }

    const userId = challenge.userId;

    // Check brute-force lockout
    if (isTotpLockedOut(userId)) {
      res.status(429).json({ error: 'Account locked due to too many failed TOTP attempts. Try again in 15 minutes.' });
      return;
    }

    const [user] = await db.select()
      .from(adminUsers)
      .where(eq(adminUsers.id, userId))
      .limit(1);
    if (!user || !user.totpSecret) {
      pendingChallenges.delete(challengeToken);
      res.status(401).json({ error: 'Invalid state' });
      return;
    }

    const secret = decryptSecret(user.totpSecret);
    if (!verifyTotp(token, secret)) {
      const count = recordTotpFailure(userId);
      const remaining = 5 - count;
      if (remaining <= 0) {
        // Update DB lockout timestamp too
        await db.update(adminUsers)
          .set({
            failedTotpAttempts: count,
            totpLockedUntil: new Date(Date.now() + 15 * 60_000),
            updatedAt: new Date(),
          })
          .where(eq(adminUsers.id, userId));
      }
      res.status(401).json({
        error: 'Invalid TOTP token',
        ...(remaining > 0 ? { attemptsRemaining: remaining } : { locked: true }),
      });
      return;
    }

    // Success — clear failures and remove challenge
    clearTotpFailures(userId);
    pendingChallenges.delete(challengeToken);
    await db.update(adminUsers)
      .set({ failedTotpAttempts: 0, totpLockedUntil: null, updatedAt: new Date() })
      .where(eq(adminUsers.id, userId));

    res.json({ authenticated: true, username: user.username, role: user.role });
  } catch (err) {
    console.error('[auth/verify-totp]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /auth/disable-2fa ─────────────────────────────────────────
// Disable 2FA. Requires password + current valid TOTP.

router.post('/auth/disable-2fa', async (req: Request, res: Response) => {
  try {
    const { username, password, token } = req.body ?? {};
    if (!username || !password || !token) {
      res.status(400).json({ error: 'username, password, and token required' });
      return;
    }

    const [user] = await db.select()
      .from(adminUsers)
      .where(eq(adminUsers.username, username))
      .limit(1);
    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    if (!user.totpEnabled || !user.totpSecret) {
      res.status(400).json({ error: '2FA is not enabled' });
      return;
    }

    // Check lockout
    if (isTotpLockedOut(user.id)) {
      res.status(429).json({ error: 'Account locked due to too many failed TOTP attempts. Try again in 15 minutes.' });
      return;
    }

    const secret = decryptSecret(user.totpSecret);
    if (!verifyTotp(token, secret)) {
      recordTotpFailure(user.id);
      res.status(401).json({ error: 'Invalid TOTP token' });
      return;
    }

    clearTotpFailures(user.id);
    await db.update(adminUsers)
      .set({
        totpSecret: null,
        totpEnabled: false,
        failedTotpAttempts: 0,
        totpLockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(adminUsers.id, user.id));

    res.json({ success: true, message: '2FA disabled successfully' });
  } catch (err) {
    console.error('[auth/disable-2fa]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /auth/status/:username ─────────────────────────────────────
// Check if 2FA is enabled for a user (public info).

router.get('/auth/status/:username', async (req: Request, res: Response) => {
  try {
    const username = req.params.username as string;
    const [user] = await db.select({ totpEnabled: adminUsers.totpEnabled })
      .from(adminUsers)
      .where(eq(adminUsers.username, username))
      .limit(1);

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({ username, totpEnabled: user.totpEnabled });
  } catch (err) {
    console.error('[auth/status]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
