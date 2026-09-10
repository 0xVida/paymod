import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

/**
 * `pm_live_` + 48 hex chars of entropy. The first 16 characters of the full
 * secret (including the prefix) are stored in the clear as the lookup key;
 * the rest only ever exists as a hash. The raw secret is shown to the caller
 * exactly once, at creation.
 */
const PREFIX_LENGTH = 16;

export const WALLET_CREDENTIAL_PREFIX = "pm_live_";
export const CODE_CREDENTIAL_PREFIX = "pmcode_";

export function generateCredential(prefix: string = WALLET_CREDENTIAL_PREFIX): { secret: string; prefix: string; hash: string } {
  const secret = `${prefix}${randomBytes(24).toString("hex")}`;
  return { secret, prefix: secret.slice(0, PREFIX_LENGTH), hash: hashCredential(secret) };
}

export function getCredentialPrefix(secret: string): string {
  return secret.slice(0, PREFIX_LENGTH);
}

export function hashCredential(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** constant-time by construction: reject on length mismatch before comparing. */
export function isCredentialMatch(secret: string, storedHashHex: string): boolean {
  const candidate = Buffer.from(hashCredential(secret), "hex");
  const stored = Buffer.from(storedHashHex, "hex");
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}
