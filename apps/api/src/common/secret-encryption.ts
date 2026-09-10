import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

function getMasterKey(): Buffer {
  const encoded = process.env.CODE_DEPOSIT_KEY_ENCRYPTION_KEY;
  if (!encoded) {
    throw new Error("CODE_DEPOSIT_KEY_ENCRYPTION_KEY must be set to store or read an encrypted deposit-address secret key");
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== KEY_LENGTH) {
    throw new Error(`CODE_DEPOSIT_KEY_ENCRYPTION_KEY must decode to ${KEY_LENGTH} bytes (base64), got ${key.length}`);
  }
  return key;
}

/**
 * AES-256-GCM with an env-var master key ("env now, KMS later", per
 * `docs/Paymod-code-build-plan.md` item 12). Fails closed if the key is
 * missing or the wrong length, never proceeds unencrypted. Output is
 * `iv:authTag:ciphertext`, each base64, self-contained with no separate
 * nonce/tag column needed.
 */
export function encryptSecret(plaintext: string): string {
  const key = getMasterKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptSecret(encoded: string): string {
  const key = getMasterKey();
  const [ivB64, authTagB64, ciphertextB64] = encoded.split(":");
  if (!ivB64 || !authTagB64 || !ciphertextB64) throw new Error("Malformed encrypted secret");
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextB64, "base64")), decipher.final()]);
  return plaintext.toString("utf8");
}
