import { z } from "zod";

/**
 * all monetary values move through the system as atomic integer strings, never
 * floats and never JS numbers. 0.25 USDC on Stellar (7 decimals) is "2500000".
 * This is what preserves micropayments exactly.
 */
export const atomicAmountSchema = z.string().regex(/^0$|^[1-9]\d*$/, {
  message: "Atomic amounts must be non-negative base-10 integer strings",
});

export const assetSchema = z.object({
  code: z.string().min(1).max(16).toUpperCase(),
  /**
   * always explicit, never assumed. Stellar USDC via the SAC is 7 decimals;
   * USDC on most EVM chains is 6. Hardcoding either one is a real bug.
   */
  decimals: z.number().int().min(0).max(30),
});

export const networkSchema = z.object({
  family: z.enum(["stellar", "evm"]),
  id: z.string().min(1),
  environment: z.enum(["testnet", "mainnet"]),
});

export const moneySchema = z.object({ asset: assetSchema, atomicAmount: atomicAmountSchema });

export type Asset = z.infer<typeof assetSchema>;
export type Network = z.infer<typeof networkSchema>;
export type Money = z.infer<typeof moneySchema>;

export function parseAtomicAmount(value: string): bigint {
  return BigInt(atomicAmountSchema.parse(value));
}

export function formatAtomicAmount(atomicAmount: string, decimals: number): string {
  const amount = parseAtomicAmount(atomicAmount);
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error("decimals must be a non-negative integer");
  }
  const base = 10n ** BigInt(decimals);
  const whole = amount / base;
  const fraction = (amount % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function addAtomic(a: string, b: string): string {
  return (parseAtomicAmount(a) + parseAtomicAmount(b)).toString();
}

export function subAtomic(a: string, b: string): string {
  const result = parseAtomicAmount(a) - parseAtomicAmount(b);
  if (result < 0n) throw new Error("Atomic subtraction would produce a negative amount");
  return result.toString();
}

/** -1 | 0 | 1, so callers never reach for `<` on strings. */
export function cmpAtomic(a: string, b: string): -1 | 0 | 1 {
  const left = parseAtomicAmount(a);
  const right = parseAtomicAmount(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

const I128_MAX = (1n << 127n) - 1n;

/**
 * `atomicAmountSchema` is deliberately unbounded, but Soroban's `execute_payment`
 * takes an i128. Enforce the ceiling at the rail boundary, not in the policy
 * engine, which must stay chain-agnostic.
 */
export function assertFitsI128(atomicAmount: string): string {
  if (parseAtomicAmount(atomicAmount) > I128_MAX) {
    throw new RangeError(`Amount ${atomicAmount} exceeds the i128 range accepted on-chain`);
  }
  return atomicAmount;
}
