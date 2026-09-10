import type { SettlementOutcome } from "@paymod/payments";

/** Circle Developer-Controlled Wallets transaction states */
export type CircleTransactionState =
  | "INITIATED"
  | "CLEARED"
  | "QUEUED"
  | "SENT"
  | "STUCK"
  | "CONFIRMED"
  | "COMPLETE"
  | "FAILED"
  | "DENIED"
  | "CANCELLED";

export type CircleTransaction = {
  state: CircleTransactionState;
  txHash?: string;
  errorReason?: string;
  updateDate: string;
};

/**
 * maps Circle's 10-state transaction enum onto Paymod's 3-valued `SettlementOutcome`.
 * INITIATED/CLEARED/QUEUED/SENT/STUCK are all non-terminal, so they collapse to UNKNOWN
 * instead of the caller special-casing each one.
 */
export function mapCircleStateToOutcome(
  transaction: CircleTransaction,
  requestedAtomicAmount: string,
): SettlementOutcome {
  const observedAt = new Date(transaction.updateDate);

  switch (transaction.state) {
    case "CONFIRMED":
    case "COMPLETE":
      if (!transaction.txHash) {
        throw new Error(`Circle reported ${transaction.state} without a txHash`);
      }
      return {
        status: "CONFIRMED",
        txRef: transaction.txHash,
        confirmedAt: observedAt,
        actualAtomic: requestedAtomicAmount,
        alreadyExecuted: false,
      };

    case "FAILED":
    case "DENIED":
      return {
        status: "FAILED",
        failureCode: transaction.errorReason ?? transaction.state,
        ...(transaction.txHash ? { txRef: transaction.txHash } : {}),
        failedAt: observedAt,
      };

    case "INITIATED":
    case "CLEARED":
    case "QUEUED":
    case "SENT":
    case "STUCK":
    case "CANCELLED":
      return {
        status: "UNKNOWN",
        reason: `circle_transaction_${transaction.state.toLowerCase()}`,
        ...(transaction.txHash ? { txRef: transaction.txHash } : {}),
        observedAt,
      };
  }
}
