import { createHash } from "node:crypto";

/**
 * the deterministic on-chain payment id: a pure function of the intent id
 * alone, so every retry from any worker after any crash maps to the same
 * `Executed(BytesN<32>)` slot on the contract. That is what makes
 * double-payment impossible at the ledger, and why blind retry is a safe
 * reconciliation strategy (re-submit; it either succeeds or the contract
 * returns `PaymentAlreadyExecuted`).
 *
 * The "v1" tag is versioning headroom: changing the derivation later
 * must not silently collide with ids already recorded on chain.
 */
export function derivePaymentId(intentId: string): Buffer {
  return createHash("sha256").update(`paymod:v1:${intentId}`).digest();
}

export function derivePaymentIdHex(intentId: string): string {
  return derivePaymentId(intentId).toString("hex");
}
