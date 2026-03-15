/**
 * US-909: WhatsApp Flows Data-Exchange Encryption/Decryption
 *
 * Meta sends encrypted payloads to the data-exchange endpoint using:
 *   1. RSA-OAEP (SHA-256) to encrypt a per-request AES key
 *   2. AES-128-GCM to encrypt the actual JSON payload
 *
 * The endpoint must decrypt, process, then re-encrypt the response
 * using the same AES key before returning it to Meta.
 *
 * Reference: https://developers.facebook.com/docs/whatsapp/flows/guides/implementingyourflowendpoint
 */
import crypto from 'crypto';

export interface DecryptedRequest {
  /** The decrypted JSON payload from Meta */
  decryptedBody: Record<string, any>;
  /** AES key to re-encrypt the response */
  aesKeyBuffer: Buffer;
  /** Initial vector for AES-GCM encryption of the response */
  initialVectorBuffer: Buffer;
}

/**
 * Decrypt an incoming WhatsApp Flows data-exchange request.
 *
 * @param body - The raw request body: { encrypted_aes_key, encrypted_flow_data, initial_vector }
 * @param privatePemKey - The RSA private key in PEM format
 */
export function decryptRequest(
  body: { encrypted_aes_key: string; encrypted_flow_data: string; initial_vector: string },
  privatePemKey: string
): DecryptedRequest {
  const { encrypted_aes_key, encrypted_flow_data, initial_vector } = body;

  // 1. Decrypt the AES key using RSA-OAEP with SHA-256
  const encryptedAesKey = Buffer.from(encrypted_aes_key, 'base64');
  const aesKeyBuffer = crypto.privateDecrypt(
    {
      key: privatePemKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    encryptedAesKey
  );

  // 2. Decrypt the flow data using AES-128-GCM
  const initialVectorBuffer = Buffer.from(initial_vector, 'base64');
  const encryptedFlowData = Buffer.from(encrypted_flow_data, 'base64');

  // GCM auth tag is the last 16 bytes of the ciphertext
  const TAG_LENGTH = 16;
  const encrypted = encryptedFlowData.subarray(0, -TAG_LENGTH);
  const authTag = encryptedFlowData.subarray(-TAG_LENGTH);

  const decipher = crypto.createDecipheriv('aes-128-gcm', aesKeyBuffer, initialVectorBuffer);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  const decryptedBody = JSON.parse(decrypted.toString('utf-8'));

  return { decryptedBody, aesKeyBuffer, initialVectorBuffer };
}

/**
 * Encrypt a response to send back to Meta via WhatsApp Flows.
 *
 * @param responseBody - The JSON response object to encrypt
 * @param aesKeyBuffer - The AES key from the decrypted request
 * @param initialVectorBuffer - The IV from the decrypted request (flipped for response)
 */
export function encryptResponse(
  responseBody: Record<string, any>,
  aesKeyBuffer: Buffer,
  initialVectorBuffer: Buffer
): string {
  // Flip the IV bytes for the response (Meta's protocol requirement)
  const flippedIv = Buffer.alloc(initialVectorBuffer.length);
  for (let i = 0; i < initialVectorBuffer.length; i++) {
    flippedIv[i] = ~initialVectorBuffer[i] & 0xff;
  }

  const cipher = crypto.createCipheriv('aes-128-gcm', aesKeyBuffer, flippedIv);
  const plaintext = JSON.stringify(responseBody);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf-8'),
    cipher.final(),
    cipher.getAuthTag(), // Append auth tag
  ]);

  return encrypted.toString('base64');
}
