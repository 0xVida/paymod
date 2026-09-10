/**
 * mirrors `@paymod/policy-engine`'s `POLICY_TYPES`, copied rather than
 * imported for the same reason as `lib/format.ts`. `WALLET_STATUS` is
 * excluded on purpose - the engine marks it "retained for spec conformance
 * only", not operator-configurable.
 */
export const POLICY_TYPES = [
  "DAILY_LIMIT",
  "MONTHLY_LIMIT",
  "PER_TRANSACTION_LIMIT",
  "APPROVAL_THRESHOLD",
  "X402_MAX_AUTOPAY",
  "ASSET_ALLOWLIST",
  "ASSET_BLOCKLIST",
  "NETWORK_ALLOWLIST",
  "NETWORK_BLOCKLIST",
  "DESTINATION_ALLOWLIST",
  "DESTINATION_BLOCKLIST",
  "ACTION_ALLOWLIST",
  "ACTION_BLOCKLIST",
] as const;
export type PolicyType = (typeof POLICY_TYPES)[number];

export type PolicyConfigShape =
  | { kind: "amount"; field: "limitAtomic" | "thresholdAtomic" | "maxAutopayAtomic" }
  | { kind: "list"; field: "values" };

const AMOUNT_FIELD: Record<string, "limitAtomic" | "thresholdAtomic" | "maxAutopayAtomic"> = {
  DAILY_LIMIT: "limitAtomic",
  MONTHLY_LIMIT: "limitAtomic",
  PER_TRANSACTION_LIMIT: "limitAtomic",
  APPROVAL_THRESHOLD: "thresholdAtomic",
  X402_MAX_AUTOPAY: "maxAutopayAtomic",
};

export function configShapeFor(type: PolicyType): PolicyConfigShape {
  const amountField = AMOUNT_FIELD[type];
  if (amountField) return { kind: "amount", field: amountField };
  return { kind: "list", field: "values" };
}

export function describePolicyType(type: PolicyType): string {
  return type
    .toLowerCase()
    .split("_")
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");
}
