/**
 * same conversion as `@paymod/shared`'s `formatAtomicAmount`, copied rather
 * than imported - that package is TS-source-only by design, and Next.js's
 * bundler can't resolve its internal `.js`-suffixed relative imports
 * against the sibling `.ts` files the way `tsx`/`tsc` do.
 */
/** Circle USDC is 6 decimals - Stellar's own USDC (7dp) only applies to the dormant Stellar rail. */
export const USDC_DECIMALS = 6;

export function formatAtomicAmount(atomicAmount: string, decimals: number): string {
  const amount = BigInt(atomicAmount);
  const base = 10n ** BigInt(decimals);
  const whole = amount / base;
  const fraction = (amount % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

/**
 * inverse of `formatAtomicAmount` - converts a human amount like "1.5" to
 * the atomic integer string. string-based, not `Number * 10^decimals`,
 * since a float can't represent 0.1 exactly and loses precision at the
 * boundary that matters for money.
 */
export function parseHumanAmount(input: string, decimals: number): string {
  const trimmed = input.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error("Enter a plain number, e.g. 1.5");
  }
  const [wholePart, fractionalPart = ""] = trimmed.split(".");
  if (fractionalPart.length > decimals) {
    throw new Error(`Supports at most ${decimals} decimal places`);
  }
  return (
    BigInt(wholePart!) * 10n ** BigInt(decimals) +
    BigInt(fractionalPart.padEnd(decimals, "0") || "0")
  ).toString();
}

/**
 * shared across every page that shows an audit action (`WALLET_ACTIVATED`,
 * `CREDENTIAL_CREATED`, ...) so it reads the same way everywhere instead of
 * raw on one page and ad-hoc-spaced on another.
 */
export function formatAuditAction(action: string): string {
  const [first, ...rest] = action.toLowerCase().split("_");
  if (!first) return action;
  return [first[0]!.toUpperCase() + first.slice(1), ...rest].join(" ");
}
