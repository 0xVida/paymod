import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const PREFIX_LENGTH = 16;

export function generateOAuthSecret(prefix: "pma" | "pmr" | "poc"): string {
  return `${prefix}_${randomBytes(32).toString("hex")}`;
}

export function hashOAuthSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function getOAuthSecretPrefix(secret: string): string {
  return secret.slice(0, PREFIX_LENGTH);
}

export function isOAuthSecretMatch(secret: string, storedHash: string): boolean {
  const expected = Buffer.from(storedHash, "hex");
  const actual = Buffer.from(hashOAuthSecret(secret), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}
