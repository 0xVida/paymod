/**
 * parses a Soroban simulation error string for `Error(Contract, #N)` and
 * maps N to `contracts/treasury/src/lib.rs`'s `Error` enum. Verified
 * against the live deployed spike treasury (CCQBVE...4GD on Stellar
 * Testnet), not guessed:
 *
 *   amount > max_per_payment    -> "Error(Contract, #6)" (PerPaymentLimitExceeded)
 *   already-recorded payment_id -> "Error(Contract, #8)" (PaymentAlreadyExecuted)
 *
 * `sim.error` is a plain string with no structured error code, so string
 * matching is the only option at simulation time. This only classifies
 * errors from simulation (what `prepare()` and `submit()`'s enforcing-mode
 * check see before anything is relayed); a definitive on-chain revert
 * AFTER submission is a different, unverified case, see
 * `StellarPaymentRail.confirm`.
 */

export const CONTRACT_ERROR_NAMES: Record<number, string> = {
  1: "AlreadyInitialized",
  2: "NotInitialized",
  3: "InvalidAmount",
  4: "InvalidPeriod",
  5: "TreasuryPaused",
  6: "PerPaymentLimitExceeded",
  7: "PeriodLimitExceeded",
  8: "PaymentAlreadyExecuted",
  9: "ArithmeticOverflow",
};

const CONTRACT_ERROR_PATTERN = /Error\(Contract,\s*#(\d+)\)/;

export function parseSimulationErrorCode(errorMessage: string): number | undefined {
  const match = CONTRACT_ERROR_PATTERN.exec(errorMessage);
  if (!match?.[1]) return undefined;
  return Number(match[1]);
}

export function parseSimulationErrorName(errorMessage: string): string | undefined {
  const code = parseSimulationErrorCode(errorMessage);
  return code === undefined ? undefined : CONTRACT_ERROR_NAMES[code];
}

/**
 * thrown by `prepare()` (and, defensively, `submit()`) when simulation
 * reports this payment id was already recorded as executed, not a
 * failure but the chain confirming a previous attempt's own work
 * (typically a reconciler retry after a worker crash). Callers should
 * treat this as CONFIRMED with `alreadyExecuted: true` and commit the
 * reservation, not surface it as an error.
 */
export class PaymentAlreadyExecutedError extends Error {
  constructor(readonly paymentId: string) {
    super(`Payment ${paymentId} was already executed on-chain`);
    this.name = "PaymentAlreadyExecutedError";
  }
}
