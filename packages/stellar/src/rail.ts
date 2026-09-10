import {
  BASE_FEE,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";
import { Api, Server, assembleTransaction } from "@stellar/stellar-sdk/rpc";
import { AssembledTransaction } from "@stellar/stellar-sdk/contract";
import { assertFitsI128, parseAtomicAmount } from "@paymod/shared";
import type {
  PaymentRail,
  PreparedSettlement,
  SettlementIntent,
  SettlementOutcome,
  SettlementSubmission,
  WalletState,
} from "@paymod/payments";
import { isValidPaymentDestination } from "./address.js";
import { readTokenBalance } from "./balance.js";
import { readTreasuryState } from "./treasury-state.js";
import type { ExecutorSigner, RelayerSigner } from "./signer.js";
import { PaymentAlreadyExecutedError, parseSimulationErrorCode } from "./contract-errors.js";

/**
 * Promoted from `contracts/treasury/relayer-spike/relay-payment.mjs`.
 *
 * Every guard from the spike survives intact: the source-address check
 * that stops the relayer being confused for the authorizer, and both
 * enforcing-mode simulations (after the executor signs, after the relayer
 * rebuilds) that validate the detached authorization rather than trusting
 * it blindly. Do not remove either simulation to save a round trip.
 *
 * Two roles, two keys, neither does the other's job:
 *   executor -> signs ONE Soroban auth entry for this specific payment
 *   relayer  -> pays the XLM fee and submits, no spending authority
 */
export class StellarPaymentRail implements PaymentRail {
  readonly network = "stellar:testnet";

  constructor(
    private readonly server: Server,
    private readonly executor: ExecutorSigner,
    private readonly relayer: RelayerSigner,
    private readonly networkPassphrase: string = Networks.TESTNET,
  ) {}

  validateDestination(address: string): boolean {
    return isValidPaymentDestination(address);
  }

  async readWalletState(externalWalletId: string): Promise<WalletState> {
    const state = await readTreasuryState(this.server, externalWalletId);
    const balance = await readTokenBalance(this.server, state.token, externalWalletId, this.networkPassphrase);
    return {
      networkId: this.network,
      address: externalWalletId,
      paused: state.paused,
      executor: state.executor,
      assetCode: "USDC",
      balanceAtomic: balance.toString(),
    };
  }

  /**
   * builds the executor-authorized call and has the executor sign only the
   * Soroban auth entry: never the transaction envelope, which the relayer
   * will rebuild against its own account and fee.
   */
  async prepare(intent: SettlementIntent): Promise<PreparedSettlement> {
    const paymentIdBytes = this.validatePrepareInputs(intent);
    const assembled = await this.buildRecordingSimulation(intent, paymentIdBytes);
    await this.authorizeExecution(assembled, intent);

    return {
      intentId: intent.intentId,
      networkId: this.network,
      paymentId: intent.paymentId,
      requestedAtomicAmount: intent.atomicAmount,
      payload: assembled.built!.toXDR(),
      preparedAt: new Date(),
      expiresAt: new Date(Date.now() + 100_000), // ~2 min, mirrors the auth entry TTL
    };
  }

  private validatePrepareInputs(intent: SettlementIntent): Buffer {
    assertFitsI128(intent.atomicAmount);
    if (!this.validateDestination(intent.destination)) {
      throw new Error(`Invalid Stellar destination address: ${intent.destination}`);
    }
    const paymentIdBytes = Buffer.from(intent.paymentId, "hex");
    if (paymentIdBytes.length !== 32) {
      throw new Error(`paymentId must be 32 bytes of hex, got ${paymentIdBytes.length}`);
    }
    return paymentIdBytes;
  }

  /**
   * the first, "recording" simulation. Verified against the live contract:
   * the Executed(payment_id) check in lib.rs runs before executor.require_auth(),
   * so a retried intent whose earlier attempt already landed surfaces HERE:
   * before the executor is even asked to sign anything.
   */
  private async buildRecordingSimulation(
    intent: SettlementIntent,
    paymentIdBytes: Buffer,
  ): Promise<AssembledTransaction<xdr.ScVal>> {
    const assembled = await AssembledTransaction.build({
      contractId: intent.externalWalletId,
      method: "execute_payment",
      args: [
        nativeToScVal(paymentIdBytes, { type: "bytes" }),
        nativeToScVal(intent.destination, { type: "address" }),
        nativeToScVal(parseAtomicAmount(intent.atomicAmount), { type: "i128" }),
      ],
      networkPassphrase: this.networkPassphrase,
      rpcUrl: this.server.serverURL.toString(),
      parseResultXdr: (result) => result,
    });

    if (!assembled.simulation) {
      throw new Error("Recording simulation did not run");
    }
    if (Api.isSimulationError(assembled.simulation)) {
      if (parseSimulationErrorCode(assembled.simulation.error) === 8) {
        throw new PaymentAlreadyExecutedError(intent.paymentId);
      }
      throw new Error(`Recording simulation failed: ${assembled.simulation.error}`);
    }
    if (!assembled.needsNonInvokerSigningBy().includes(this.executor.publicKey())) {
      throw new Error("Executor was not requested to authorize this payment");
    }
    return assembled;
  }

  /**
   * Signs the detached auth entry and re-simulates in enforcing mode to
   * verify it actually satisfies the contract before handing this to the
   * relayer. Soroban auth entries expire fast (~2 minutes at 5s/ledger x 24
   * ledgers). Never call this long before the payment will actually submit.
   */
  private async authorizeExecution(
    assembled: AssembledTransaction<xdr.ScVal>,
    intent: SettlementIntent,
  ): Promise<void> {
    const expirationLedger = assembled.simulation!.latestLedger + 24;
    await assembled.signAuthEntries({
      address: this.executor.publicKey(),
      signAuthEntry: this.executor.signAuthEntry,
      expiration: expirationLedger,
    });

    await assembled.simulate();
    if (!assembled.simulation) {
      throw new Error("Executor authorization simulation did not run");
    }
    if (Api.isSimulationError(assembled.simulation)) {
      if (parseSimulationErrorCode(assembled.simulation.error) === 8) {
        throw new PaymentAlreadyExecutedError(intent.paymentId);
      }
      throw new Error(`Executor authorization validation failed: ${assembled.simulation.error}`);
    }
    if (assembled.needsNonInvokerSigningBy().length !== 0) {
      throw new Error("A required authorization entry remains unsigned");
    }
  }

  async submit(prepared: PreparedSettlement): Promise<SettlementSubmission> {
    const { executorTx, sorobanData, invoke } = this.extractExecutorInvocation(prepared.payload as string);

    // Paymod must constrain the envelope it is willing to relay. This is a
    // hard boundary against ever relaying arbitrary caller-supplied XDR.
    if (executorTx.source === this.relayer.publicKey()) {
      throw new Error("Authorization transaction must not use the relayer as source");
    }

    const assembled = await this.relayTransaction(executorTx, sorobanData, invoke, prepared.paymentId);
    const rawEnvelope = assembled.toXDR();
    const submitted = await this.server.sendTransaction(assembled);

    return {
      intentId: prepared.intentId,
      networkId: this.network,
      paymentId: prepared.paymentId,
      requestedAtomicAmount: prepared.requestedAtomicAmount,
      txRef: submitted.hash,
      submittedAt: new Date(),
      rawEnvelope,
    };
  }

  /** parses and validates the shape of the executor-authorized envelope `prepare()` produced. */
  private extractExecutorInvocation(executorAuthorizedXdr: string): {
    executorTx: Transaction;
    sorobanData: xdr.SorobanTransactionData;
    invoke: Operation.InvokeHostFunction & { auth: xdr.SorobanAuthorizationEntry[] };
  } {
    const executorTx = new Transaction(executorAuthorizedXdr, this.networkPassphrase);
    const envelope = xdr.TransactionEnvelope.fromXDR(executorAuthorizedXdr, "base64");
    const sorobanData = envelope.v1()?.tx()?.ext()?.sorobanData();
    if (!sorobanData) throw new Error("Missing Soroban transaction data");

    const invoke = executorTx.operations[0];
    if (
      executorTx.operations.length !== 1 ||
      !invoke ||
      invoke.type !== "invokeHostFunction" ||
      !Array.isArray(invoke.auth)
    ) {
      throw new Error("Expected exactly one executor-authorized contract invocation");
    }
    return { executorTx, sorobanData, invoke: { ...invoke, auth: invoke.auth } };
  }

  /**
   * Rebuilds the invocation against the relayer's own account and fee,
   * enforcing-mode simulates (refreshing the resource fee and verifying the
   * executor's signed auth entry before Paymod pays network fees; don't
   * skip this to save latency) and signs. Never sends.
   */
  private async relayTransaction(
    executorTx: Transaction,
    sorobanData: xdr.SorobanTransactionData,
    invoke: Operation.InvokeHostFunction & { auth: xdr.SorobanAuthorizationEntry[] },
    paymentId: string,
  ): Promise<Transaction> {
    const relayerAccount = await this.server.getAccount(this.relayer.publicKey());
    const relayedTx = new TransactionBuilder(relayerAccount, {
      fee: executorTx.fee || BASE_FEE,
      networkPassphrase: this.networkPassphrase,
      sorobanData,
    })
      .addOperation(
        Operation.invokeHostFunction({
          func: invoke.func,
          auth: invoke.auth,
          ...(invoke.source !== undefined && { source: invoke.source }),
        }),
      )
      .setTimeout(30)
      .build();

    const simulation = await this.server.simulateTransaction(relayedTx);
    if (Api.isSimulationError(simulation)) {
      // defense in depth: a concurrent retry (a second worker or the
      // sweeper) could execute this exact payment between this rail's
      // `prepare()` and `submit()` calls. Same detection as `prepare()`.
      if (parseSimulationErrorCode(simulation.error) === 8) {
        throw new PaymentAlreadyExecutedError(paymentId);
      }
      throw new Error(`Relayer validation failed: ${simulation.error}`);
    }

    const assembled = assembleTransaction(relayedTx, simulation).build();
    assembled.sign(this.relayer.keypair());
    return assembled;
  }

  /**
   * Three-valued by design: see `@paymod/payments`.
   *
   * A genuine on-chain revert of `execute_payment` (errors 5/6/7: paused,
   * per-payment cap, period cap) essentially can't reach this method:
   * `submit()`'s enforcing-mode simulation runs immediately before
   * `sendTransaction` and throws first, and Soroban refuses to submit a
   * transaction whose simulation failed. The only path to a real
   * post-submission revert is a narrow TOCTOU race between that
   * simulation and the ledger closing (e.g. another payment exhausts the
   * period budget in between).
   *
   * Distinguishing that race's DEFINITIVE failure from a genuinely
   * UNKNOWN outcome requires parsing the result XDR for the specific
   * contract error code, verified against a real on-chain revert before
   * it can authorize a reservation release - unverified parsing here is
   * exactly how a double-spend gets built. That verification belongs to
   * Slice 6 (reconciler hardening). Until then every non-success,
   * non-`PaymentAlreadyExecuted` status is treated as UNKNOWN: the
   * reservation stays held until a human or the reconciler resolves it.
   * Over-reservation, never over-payment.
   */
  async confirm(submission: SettlementSubmission): Promise<SettlementOutcome> {
    let final: Api.GetTransactionResponse;
    try {
      final = await this.server.pollTransaction(submission.txRef);
    } catch (error) {
      return {
        status: "UNKNOWN",
        reason: `poll failed: ${error instanceof Error ? error.message : String(error)}`,
        txRef: submission.txRef,
        observedAt: new Date(),
      };
    }

    if (final.status === "SUCCESS") {
      // execute_payment returns Result<(), Error> (no value on success)
      // and is all-or-nothing on `amount` (no partial-fill path), so
      // SUCCESS means exactly the requested amount moved.
      return {
        status: "CONFIRMED",
        txRef: submission.txRef,
        confirmedAt: new Date(),
        actualAtomic: submission.requestedAtomicAmount,
        alreadyExecuted: false,
      };
    }

    return {
      status: "UNKNOWN",
      reason: `poll returned ${final.status}; contract-error classification is not yet verified (Slice 6)`,
      txRef: submission.txRef,
      observedAt: new Date(),
    };
  }
}

