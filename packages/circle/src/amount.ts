const USDC_DECIMALS = 6;
const USDC_ATOMIC_UNIT = 10n ** BigInt(USDC_DECIMALS);

/** atomic (smallest-unit) integer string, e.g. "1500000" -> decimal string Circle's API expects, e.g. "1.5" */
export function fromAtomicUsdc(atomicAmount: string): string {
  const amount = BigInt(atomicAmount);
  const whole = amount / USDC_ATOMIC_UNIT;
  const fraction = amount % USDC_ATOMIC_UNIT;
  if (fraction === 0n) return whole.toString();
  const fractionDigits = fraction.toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  return `${whole}.${fractionDigits}`;
}

/** decimal string, e.g. "1.5" -> atomic integer string, e.g. "1500000" */
export function toAtomicUsdc(decimalAmount: string): string {
  const [whole = "0", fraction = ""] = decimalAmount.split(".");
  if (fraction.length > USDC_DECIMALS) {
    throw new Error(`USDC amount has more than ${USDC_DECIMALS} decimal places: ${decimalAmount}`);
  }
  const paddedFraction = fraction.padEnd(USDC_DECIMALS, "0");
  return (BigInt(whole) * USDC_ATOMIC_UNIT + BigInt(paddedFraction || "0")).toString();
}
