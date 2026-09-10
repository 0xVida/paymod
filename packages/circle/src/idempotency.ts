import { createHash } from "node:crypto";

/**
 * a naive reformat of hash bytes into dashes isn't a structurally valid
 * UUID v4 - the version and variant bits must be stamped explicitly.
 */
function toUuidV4(bytes16: Buffer): string {
  bytes16[6] = (bytes16[6]! & 0x0f) | 0x40;
  bytes16[8] = (bytes16[8]! & 0x3f) | 0x80;
  const hex = bytes16.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Circle requires a UUID v4 `idempotencyKey` and replays the original response on
 * retry. deriving it from Paymod's deterministic `paymentId` (`derivePaymentIdHex` in
 * `@paymod/stellar`) reuses that replay-safety guarantee instead of a second id scheme.
 */
export function circleIdempotencyKey(paymentIdHex: string): string {
  return toUuidV4(Buffer.from(paymentIdHex, "hex").subarray(0, 16));
}

/**
 * same replay-safety guarantee as `circleIdempotencyKey`, for wallet creation - a crash
 * between Circle creating the wallet and Paymod persisting `externalWalletId` must retry
 * into the same wallet. namespaced ("paymod:circle-wallet:v1") to avoid colliding with payment keys.
 */
export function circleWalletIdempotencyKey(walletId: string): string {
  const digest = createHash("sha256").update(`paymod:circle-wallet:v1:${walletId}`).digest();
  return toUuidV4(digest.subarray(0, 16));
}
