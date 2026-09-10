import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

/**
 * `pcs_` + 48 hex chars of entropy, mirroring `credentials.ts`'s
 * `pm_live_` shape: the first 16 characters are the non-secret lookup
 * prefix, the rest only ever exists as a hash. The raw token is set as an
 * httpOnly cookie once, at login and never readable again server-side.
 */
const PREFIX_LENGTH = 16;

export function generateSessionToken(): { token: string; prefix: string; hash: string } {
  const token = `pcs_${randomBytes(24).toString("hex")}`;
  return { token, prefix: token.slice(0, PREFIX_LENGTH), hash: hashSessionToken(token) };
}

export function getSessionTokenPrefix(token: string): string {
  return token.slice(0, PREFIX_LENGTH);
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** constant-time by construction: reject on length mismatch before comparing. */
export function isSessionTokenMatch(token: string, storedHashHex: string): boolean {
  const candidate = Buffer.from(hashSessionToken(token), "hex");
  const stored = Buffer.from(storedHashHex, "hex");
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}
