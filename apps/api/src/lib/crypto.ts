import crypto from 'crypto';
import { config } from '../config.js';

const PREFIX = 'enc:v1:';
const ALGO = 'aes-256-gcm';

function getKey(): Buffer | null {
  if (!config.WPP_TOKEN_ENC_KEY) return null;
  return Buffer.from(config.WPP_TOKEN_ENC_KEY, 'hex');
}

// Encrypts WhatsApp credentials at rest. No-op (returns plaintext) when
// WPP_TOKEN_ENC_KEY isn't set, so dev environments work without extra setup.
export function encryptSecret(plain: string): string {
  const key = getKey();
  if (!key) return plain;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return PREFIX + Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

// Transparently reads both encrypted values and legacy plaintext values
// (anything written before WPP_TOKEN_ENC_KEY was configured).
export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return stored ?? null;
  if (!stored.startsWith(PREFIX)) return stored; // legacy plaintext

  const key = getKey();
  if (!key) return stored; // can't decrypt without the key - caller will fail auth, which is safe

  try {
    const raw = Buffer.from(stored.slice(PREFIX.length), 'base64');
    const iv = raw.subarray(0, 12);
    const authTag = raw.subarray(12, 28);
    const ciphertext = raw.subarray(28);
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
