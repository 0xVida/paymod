/**
 * chain-neutral settlement contract.
 *
 * This package must never import a blockchain SDK. `@paymod/stellar` (and later
 * `@paymod/arc`) implement `PaymentRail` against it. If you find yourself
 * reaching for a Stellar type here, it belongs in the adapter instead.
 *
 * The three-valued settlement outcome below is load-bearing. See
 * `isSafeToRelease` for the invariant it exists to protect.
 */

export type NetworkId = string; // CAIP-2, e.g. "stellar:testnet"

/** what the account has authorized. Chain-agnostic by construction. */
export type SettlementIntent = {
  intentId: string; // int_...
  requestId: string; // req_...
  accountId: string; // acc_...
  walletId: string; // wal_...
  /**
   * the rail-native handle for this wallet, not a Paymod database id:
   * Stellar's on-chain contract address, or Circle's own walletId.
   * Renamed from `contractId`, which was Soroban-specific and didn't
   * describe a Circle-rail wallet.
   */
  externalWalletId: string;
  networkId: NetworkId;
  assetCode: string;
  /** atomic integer string. Never a float, never a Number. */
  atomicAmount: string;
  destination: string;
  /**
   * Deterministic, derived purely from intentId. The same intent always yields
   * the same paymentId across retries, workers and process restarts: this is
   * what makes double-payment impossible at the ledger rather than merely
   * improbable in the application. Adapters must not generate their own.
   */
  paymentId: string;
  expiresAt: Date;
  metadata: Record<string, unknown>;
};

/** adapter-built, not yet submitted. `payload` is adapter-private. */
export type PreparedSettlement = {
  intentId: string;
  networkId: NetworkId;
  paymentId: string;
  requestedAtomicAmount: string;
  payload: unknown;
  preparedAt: Date;
  /** auth entries expire fast (Soroban: ~2min). Never prepare before approval. */
  expiresAt: Date;
};

export type SettlementSubmission = {
  intentId: string;
  networkId: NetworkId;
  paymentId: string;
  /**
   * what this submission is settling. On an all-or-nothing rail (the
   * Stellar treasury contract has no partial-fill semantics), `confirm()`
   * echoes this back as `actualAtomic`. A rail that supports partial
   * capture reports its own true amount instead.
   */
  requestedAtomicAmount: string;
  /** chain-native reference; a transaction hash on both Stellar and EVM. */
  txRef: string;
  submittedAt: Date;
  /** persist before submitting, so a crash mid-flight is still traceable. */
  rawEnvelope?: string;
};

/**
 * Settlement is three-valued, not boolean. The middle case ("we genuinely do
 * not know") is the one that matters and collapsing it into failure is how
 * double-spends get built.
 */
export type SettlementOutcome =
  | {
      status: "CONFIRMED";
      txRef: string;
      confirmedAt: Date;
      /** what actually moved. May differ from requested; never exceeds it. */
      actualAtomic: string;
      /**
       * True when the chain reported this payment had already been executed by
       * a previous attempt. That is confirmation of our own prior work, not a
       * failure: the money moved exactly once and the reservation must be
       * committed, not released.
       */
      alreadyExecuted: boolean;
    }
  | {
      /**
       * Proven non-execution: the chain rejected the payment and reverted all
       * state, including the replay-protection slot. Retrying the same
       * paymentId is legal and the reservation is safe to release.
       */
      status: "FAILED";
      failureCode: string;
      txRef?: string;
      failedAt: Date;
    }
  | {
      /**
       * RPC outage, poll timeout, process crash, expired transaction. The
       * payment may or may not have landed. Resolve by re-submitting the same
       * deterministic paymentId: it either succeeds (never landed) or reports
       * already-executed (it did). Retry is the reconciliation strategy.
       */
      status: "UNKNOWN";
      reason: string;
      txRef?: string;
      observedAt: Date;
    };

/**
 * the single invariant this package exists to enforce:
 *
 *   reserved -> spent    only on confirmed success
 *   reserved -> released only on *proven* non-execution
 *   anything unknown     stays reserved
 *
 * The chosen failure mode is over-reservation (a wallet is briefly
 * under-budgeted until the reconciler resolves it) rather than over-payment.
 * For a permission layer that is the only acceptable direction.
 */
export function isSafeToRelease(outcome: SettlementOutcome): boolean {
  return outcome.status === "FAILED";
}

export function isTerminal(outcome: SettlementOutcome): boolean {
  return outcome.status !== "UNKNOWN";
}

/**
 * Renamed from `TreasurySnapshot` - "treasury" assumed Stellar's Soroban
 * treasury-contract model. Circle has no per-wallet contract to snapshot,
 * just wallet/balance/authority state, so the type name shouldn't imply
 * one either.
 */
export type WalletState = {
  networkId: NetworkId;
  address: string;
  paused: boolean;
  /**
   * the signer/authority Paymod expects to control this wallet - Stellar:
   * the on-chain executor role; Circle: the entity/API identity Circle
   * expects requests to originate from. Verify before every submission.
   */
  executor: string;
  assetCode: string;
  balanceAtomic: string;
};

export interface PaymentRail {
  readonly network: NetworkId;

  validateDestination(address: string): boolean;

  /**
   * Renamed from `readTreasury` - same reasoning as `WalletState` above.
   * Parameter renamed from `treasuryAddress` to `externalWalletId` to match
   * the field it's actually populated from (`AgentWallet.contractId` for
   * Stellar, `AgentWallet.externalWalletId` for every other rail).
   */
  readWalletState(externalWalletId: string): Promise<WalletState>;

  prepare(intent: SettlementIntent): Promise<PreparedSettlement>;

  submit(prepared: PreparedSettlement): Promise<SettlementSubmission>;

  confirm(submission: SettlementSubmission): Promise<SettlementOutcome>;
}
