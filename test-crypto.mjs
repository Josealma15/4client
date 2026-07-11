import crypto from 'crypto';

const PREFIX = 'enc:v1:';
const ALGO = 'aes-256-gcm';

function encryptSecret(plain, keyBuffer) {
  if (!keyBuffer) return plain;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, keyBuffer, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return PREFIX + Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

try {
  console.log(encryptSecret("EAALQ...", null));
  console.log(encryptSecret("EAALQ...", Buffer.alloc(32, 'a')));
  console.log("Success");
} catch (e) {
  console.error("Error:", e);
}
