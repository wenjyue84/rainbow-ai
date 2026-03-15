/**
 * WhatsApp Flows Data Exchange Encryption (US-909)
 *
 * Meta encrypts Flow data-exchange payloads using:
 *   1. AES-128-GCM for the body (symmetric)
 *   2. RSA-OAEP (SHA-256) to wrap the AES key
 *
 * This module decrypts incoming payloads and encrypts responses.
 *
 * Required env vars:
 *   WA_FLOWS_PRIVATE_KEY  — PEM-encoded RSA private key
 *   WA_FLOWS_PASSPHRASE   — passphrase for the private key (optional)
 */

import crypto from 'crypto';

const AES_ALGORITHM = 'aes-128-gcm';
const TAG_LENGTH = 16; // GCM auth tag is 16 bytes

/**
 * Load the private key from env. Returns null if not configured.
 */
function getPrivateKey(): crypto.KeyObject | null {
  const pem = process.env.WA_FLOWS_PRIVATE_KEY;
  if (!pem) return null;

  return crypto.createPrivateKey({
    key: pem,
    passphrase: process.env.WA_FLOWS_PASSPHRASE || undefined,
  });
}

export interface DecryptedFlowRequest {
  decryptedBody: Record<string, any>;
  aesKeyBuffer: Buffer;
  initialVectorBuffer: Buffer;
}

/**
 * Decrypt an incoming WhatsApp Flows data-exchange request.
 *
 * The request body contains:
 *   - encrypted_aes_key: base64-encoded RSA-OAEP encrypted AES key
 *   - encrypted_flow_data: base64-encoded AES-128-GCM ciphertext
 *   - initial_vector: base64-encoded IV for AES-GCM
 */
export function decryptFlowRequest(body: {
  encrypted_aes_key: string;
  encrypted_flow_data: string;
  initial_vector: string;
}): DecryptedFlowRequest {
  const privateKey = getPrivateKey();
  if (!privateKey) {
    throw new Error('WA_FLOWS_PRIVATE_KEY not configured');
  }

  const { encrypted_aes_key, encrypted_flow_data, initial_vector } = body;

  // Step 1: Decrypt the AES key using RSA-OAEP
  const encryptedAesKey = Buffer.from(encrypted_aes_key, 'base64');
  const aesKeyBuffer = crypto.privateDecrypt(
    {
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    encryptedAesKey,
  );

  // Step 2: Decrypt the flow data using AES-128-GCM
  const initialVectorBuffer = Buffer.from(initial_vector, 'base64');
  const encryptedFlowData = Buffer.from(encrypted_flow_data, 'base64');

  // GCM auth tag is appended to the ciphertext
  const authTag = encryptedFlowData.subarray(-TAG_LENGTH);
  const ciphertext = encryptedFlowData.subarray(0, -TAG_LENGTH);

  const decipher = crypto.createDecipheriv(AES_ALGORITHM, aesKeyBuffer, initialVectorBuffer);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const decryptedBody = JSON.parse(decrypted.toString('utf-8'));

  return { decryptedBody, aesKeyBuffer, initialVectorBuffer };
}

/**
 * Encrypt a response back to Meta using the same AES key but a flipped IV.
 */
export function encryptFlowResponse(
  responseBody: Record<string, any>,
  aesKeyBuffer: Buffer,
  initialVectorBuffer: Buffer,
): string {
  // Flip the IV bytes for the response (Meta requirement)
  const flippedIv = Buffer.alloc(initialVectorBuffer.length);
  for (let i = 0; i < initialVectorBuffer.length; i++) {
    flippedIv[i] = ~initialVectorBuffer[i] & 0xff;
  }

  const cipher = crypto.createCipheriv(AES_ALGORITHM, aesKeyBuffer, flippedIv);
  const jsonStr = JSON.stringify(responseBody);

  const encrypted = Buffer.concat([cipher.update(jsonStr, 'utf-8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Concatenate ciphertext + auth tag, then base64 encode
  return Buffer.concat([encrypted, authTag]).toString('base64');
}

/**
 * Check if Flow encryption keys are configured.
 */
export function isFlowCryptoConfigured(): boolean {
  return !!process.env.WA_FLOWS_PRIVATE_KEY;
}

// ─── Data API v4.0 Two-Signature Auth (US-927) ───────────────────────────────

export interface FlowSignatureResult {
  valid: boolean;
  reason?: string;
}

/**
 * Verify the platform-side HMAC-SHA256 signature sent by Meta on every
 * WhatsApp Flows Data API v4.0 request.
 *
 * Meta sends:  X-Hub-Signature-256: sha256=<hex>
 * Computed as: HMAC-SHA256(rawRequestBody, META_APP_SECRET)
 *
 * @param rawBody   Raw request body Buffer (from captureRawBody middleware)
 * @param sigHeader Value of the X-Hub-Signature-256 header
 * @param appSecret META_APP_SECRET env value
 */
export function verifyFlowPlatformSignature(
  rawBody: Buffer,
  sigHeader: string,
  appSecret: string,
): FlowSignatureResult {
  if (!appSecret) {
    return { valid: false, reason: 'META_APP_SECRET not configured' };
  }
  if (!sigHeader) {
    return { valid: false, reason: 'Missing X-Hub-Signature-256 header' };
  }

  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');

  const sigBuf = Buffer.from(sigHeader);
  const expectedBuf = Buffer.from(expected);

  if (
    sigBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(sigBuf, expectedBuf)
  ) {
    return { valid: false, reason: 'Signature mismatch' };
  }

  return { valid: true };
}

/**
 * Optionally verify the flow token signature (second HMAC in v4.0).
 *
 * Meta sends:  X-Hub-Flow-Token-Signature: sha256=<hex>
 * Computed as: HMAC-SHA256(flowToken, RAINBOW_FLOWS_TOKEN_SECRET)
 *
 * Only called when RAINBOW_FLOWS_VERIFY_TOKEN_SIG=true.
 *
 * @param flowToken  The plain-text flow_token from the decrypted payload
 * @param sigHeader  Value of the X-Hub-Flow-Token-Signature header
 * @param tokenSecret RAINBOW_FLOWS_TOKEN_SECRET env value
 */
export function verifyFlowTokenSignature(
  flowToken: string,
  sigHeader: string,
  tokenSecret: string,
): FlowSignatureResult {
  if (!tokenSecret) {
    return { valid: false, reason: 'RAINBOW_FLOWS_TOKEN_SECRET not configured' };
  }
  if (!sigHeader) {
    return { valid: false, reason: 'Missing X-Hub-Flow-Token-Signature header' };
  }

  const expected =
    'sha256=' + crypto.createHmac('sha256', tokenSecret).update(flowToken).digest('hex');

  const sigBuf = Buffer.from(sigHeader);
  const expectedBuf = Buffer.from(expected);

  if (
    sigBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(sigBuf, expectedBuf)
  ) {
    return { valid: false, reason: 'Flow token signature mismatch' };
  }

  return { valid: true };
}
