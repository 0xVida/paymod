import { publicEncrypt, constants } from "node:crypto";
import { readFile } from "node:fs/promises";

async function readSecret(varName: string): Promise<string> {
  const inline = process.env[varName];
  if (inline) return inline;
  const filePath = process.env[`${varName}_FILE`];
  if (filePath) return (await readFile(filePath, "utf8")).trim();
  throw new Error(`Missing ${varName} or ${varName}_FILE`);
}

export async function loadEntitySecretHex(varName = "CIRCLE_ENTITY_SECRET"): Promise<string> {
  const secret = await readSecret(varName);
  if (!/^[0-9a-f]{64}$/i.test(secret)) {
    throw new Error(`${varName} must be a 32-byte hex-encoded secret (64 hex characters)`);
  }
  return secret;
}

export async function loadEntityPublicKeyPem(varName = "CIRCLE_ENTITY_PUBLIC_KEY"): Promise<string> {
  return readSecret(varName);
}

/**
 * Circle requires a fresh RSA-OAEP-SHA256 ciphertext of the entity secret on
 * every request that touches funds. reusing a ciphertext across calls isn't
 * supported by their API, so this is called per-request, never cached.
 */
export function encryptEntitySecret(entitySecretHex: string, publicKeyPem: string): string {
  const entitySecretBytes = Buffer.from(entitySecretHex, "hex");
  const ciphertext = publicEncrypt(
    {
      key: publicKeyPem,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    entitySecretBytes,
  );
  return ciphertext.toString("base64");
}
