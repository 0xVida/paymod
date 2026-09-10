import { Inject, Injectable, Logger } from "@nestjs/common";
import type { PaymentRail, SettlementIntent, SettlementOutcome } from "@paymod/payments";
import { Prisma, ReservationRepository } from "@paymod/database";
import { derivePaymentIdHex, PaymentAlreadyExecutedError } from "@paymod/stellar";
import { newId } from "@paymod/shared";
import { evaluatePolicy } from "@paymod/policy-engine";
import { PrismaService } from "../common/prisma.service.js";
import { AuditService } from "../audit/audit.service.js";
import { PAYMENT_RAIL } from "./payment-rail.token.js";
import { loadPolicyRules, resolveBudgets } from "../intents/budget-resolution.js";

/** raw drivers return NUMERIC as Decimal, string or bigint depending on path */
function toAtomicString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Prisma.Decimal) return value.toFixed(0);
  throw new Error(`Cannot coerce ${typeof value} to an atomic amount string`);
}

/** a worker lease longer than this is assumed to belong to a dead process */
const CLAIM_LEASE_MS = 2 * 60 * 1000;

/**
 * Phase B of the settlement ordering documented in docs/BUILD_PLAN.md.
 *
 * the invariant this whole file exists to protect:
 *   reserved -> spent    only on confirmed success
 *   reserved -> released only on PROVEN non-execution
 *   anything unknown     stays reserved
 */
@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);
  private readonly reservations: ReservationRepository;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(PAYMENT_RAIL) private readonly rail: PaymentRail,
  ) {
    this.reservations = new ReservationRepository(prisma);
  }

  async processIntent(intentId: string): Promise<void> {
    const claimed = await this.claim(intentId);
    if (!claimed) {
      this.logger.debug(`Intent ${intentId} could not be claimed (already settled or leased elsewhere)`);
      return;
    }

    const gate = await this.reverify(claimed);
    if (!gate.ok) {
      await this.handleReverificationFailure(intentId, claimed, gate.reason);
      return;
    }

    // `reverify` already refused a wallet with neither contractId nor
    // externalWalletId set, so exactly one is guaranteed non-null here -
    // the return type just doesn't narrow it.
    const externalWalletId = gate.wallet.contractId ?? gate.wallet.externalWalletId!;
    const intent = this.buildSettlementIntent(claimed, { externalWalletId });
    await this.upsertSettlement(intentId, gate.wallet.id, intent.paymentId);
    await this.attemptSettlement(intentId, intent);
  }

  private async handleReverificationFailure(
    intentId: string,
    claimed: { accountId: string; requestId: string },
    reason: string,
  ): Promise<void> {
    await this.reservations.release(intentId);
    await this.updateIntent(intentId, "FAILED", reason);
    await this.audit.record({
      accountId: claimed.accountId,
      actorType: "SYSTEM",
      action: "INTENT_REVERIFICATION_FAILED",
      targetType: "intent",
      targetId: intentId,
      requestId: claimed.requestId,
      payload: { reason },
    });
  }

  private buildSettlementIntent(
    claimed: {
      id: string;
      requestId: string;
      accountId: string;
      walletId: string;
      networkId: string;
      assetCode: string;
      atomicAmount: unknown;
      destination: string;
      expiresAt: Date;
    },
    wallet: { externalWalletId: string },
  ): SettlementIntent {
    return {
      intentId: claimed.id,
      requestId: claimed.requestId,
      accountId: claimed.accountId,
      walletId: claimed.walletId,
      externalWalletId: wallet.externalWalletId,
      networkId: claimed.networkId,
      assetCode: claimed.assetCode,
      atomicAmount: toAtomicString(claimed.atomicAmount),
      destination: claimed.destination,
      paymentId: derivePaymentIdHex(claimed.id),
      expiresAt: claimed.expiresAt,
      metadata: {},
    };
  }

  private async attemptSettlement(intentId: string, intent: SettlementIntent): Promise<void> {
    try {
      const prepared = await this.rail.prepare(intent);
      const submission = await this.rail.submit(prepared);
      await this.recordAttempt(intentId, submission.txRef, submission.rawEnvelope);

      const outcome = await this.rail.confirm(submission);
      await this.applyOutcome(intentId, outcome);
    } catch (error) {
      await this.handleSettlementError(intentId, intent, error);
    }
  }

  private async handleSettlementError(intentId: string, intent: SettlementIntent, error: unknown): Promise<void> {
    if (error instanceof PaymentAlreadyExecutedError) {
      // the chain confirming a previous attempt's own work, most often seen
      // when the sweeper retries an intent whose earlier submission actually
      // landed before a worker crash or timeout was observed.
      await this.applyOutcome(intentId, {
        status: "CONFIRMED",
        txRef: "unknown-prior-submission",
        confirmedAt: new Date(),
        actualAtomic: intent.atomicAmount,
        alreadyExecuted: true,
      });
      return;
    }
    // anything else here is indeterminate by definition - prepare/submit threw
    // before we could observe a chain outcome. leave the reservation held -
    // the sweeper will re-claim and retry with the same deterministic paymentId.
    this.logger.error(`Settlement attempt failed for intent ${intentId}: ${(error as Error).message}`);
    await this.markUnknown(intentId, (error as Error).message);
  }

  /**
   * the `type = 'TRANSFER'` predicate is a hard boundary, not a filter - this
   * service settles via `execute_payment`, which is the wrong mechanism for
   * every other intent type. an X402_PAYMENT reaching here would pay the
   * merchant outside the x402 protocol. enforced in the claim itself rather
   * than in the caller so no future enqueue path can bypass it.
   */
  private async claim(intentId: string) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        accountId: string;
        walletId: string;
        requestId: string;
        atomicAmount: unknown;
        assetCode: string;
        networkId: string;
        destination: string;
        expiresAt: Date;
      }>
    >`
      UPDATE "financial_intents"
      SET "status" = 'PROCESSING', "locked_at" = now(), "attempts" = "attempts" + 1
      WHERE "id" = ${intentId}
        AND "type" = 'TRANSFER'::"IntentType"
        AND "status" IN ('AUTHORIZED', 'PROCESSING')
        AND ("locked_at" IS NULL OR "locked_at" < now() - make_interval(secs => ${CLAIM_LEASE_MS / 1000}))
      RETURNING "id", "account_id" AS "accountId", "wallet_id" AS "walletId", "request_id" AS "requestId",
                "atomic_amount" AS "atomicAmount", "asset_code" AS "assetCode", "network_id" AS "networkId",
                "destination", "expires_at" AS "expiresAt"
    `;
    return rows[0];
  }

  /**
   * every check here re-verifies against fresh state (never the values
   * carried in from policy evaluation) and independently confirms the
   * wallet named by this intent is the one actually being invoked (ADR
   * 0010's wallet-binding invariant) - `claimed.walletId` must resolve to a
   * real, contract-bearing wallet before anything is built against it.
   */
  private async reverify(claimed: {
    id: string;
    accountId: string;
    walletId: string;
    atomicAmount: unknown;
    assetCode: string;
    networkId: string;
    destination: string;
  }) {
    const [account, wallet] = await Promise.all([
      this.prisma.account.findUniqueOrThrow({ where: { id: claimed.accountId } }),
      this.prisma.agentWallet.findUniqueOrThrow({ where: { id: claimed.walletId } }),
    ]);

    if (account.status !== "ACTIVE") return { ok: false as const, reason: "account_suspended" };
    if (wallet.accountId !== account.id) return { ok: false as const, reason: "wallet_account_mismatch" };
    if (wallet.status === "ARCHIVED") return { ok: false as const, reason: "wallet_archived" };
    // rail-neutral - exactly one of contractId (Stellar)/externalWalletId
    // (every other rail) is populated, depending on wallet.rail (see
    // packages/database's schema doc comment on AgentWallet.externalWalletId).
    const externalWalletId = wallet.contractId ?? wallet.externalWalletId;
    if (wallet.status !== "ACTIVE" || !externalWalletId) return { ok: false as const, reason: "wallet_unverified" };

    const policyReason = await this.reverifyPolicy(claimed, account, wallet);
    if (policyReason) return { ok: false as const, reason: policyReason };

    const snapshot = await this.rail.readWalletState(externalWalletId);
    if (snapshot.paused) return { ok: false as const, reason: "wallet_contract_paused" };
    // executorAddress is Stellar-only (the on-chain executor role a Soroban
    // treasury contract enforces), null for every other rail. a non-Stellar
    // rail's own authority check belongs in that rail's confirm()/prepare(),
    // not bolted onto this Stellar-shaped comparison.
    if (wallet.contractId && snapshot.executor !== wallet.executorAddress) {
      return { ok: false as const, reason: "executor_mismatch" };
    }
    if (BigInt(snapshot.balanceAtomic) < BigInt(toAtomicString(claimed.atomicAmount))) {
      return { ok: false as const, reason: "insufficient_wallet_balance" };
    }

    return { ok: true as const, wallet };
  }

  /** a human approval satisfies REQUIRE_APPROVAL, never a fresh hard denial */
  private async reverifyPolicy(
    claimed: { id: string; accountId: string; walletId: string; atomicAmount: unknown; assetCode: string; networkId: string; destination: string },
    account: { id: string; status: "ACTIVE" | "SUSPENDED" },
    wallet: { id: string; status: string },
  ): Promise<string | undefined> {
    return this.prisma.$transaction(async (tx) => {
      const policies = await loadPolicyRules(tx, account.id);
      const { budgetsForEngine } = await resolveBudgets(
        this.reservations,
        tx,
        { accountId: account.id, walletId: wallet.id, assetCode: claimed.assetCode, networkId: claimed.networkId },
        policies,
      );
      const reservations = await tx.spendReservation.findMany({
        where: { intentId: claimed.id, status: "RESERVED" },
        include: { budgetPeriod: { select: { window: true } } },
      });
      const held = new Set(reservations.map((reservation) => reservation.budgetPeriod.window));
      const amount = BigInt(toAtomicString(claimed.atomicAmount));
      const budgets = (budgetsForEngine ?? []).map((budget) => ({
        ...budget,
        reservedAtomic: held.has(budget.window) ? (BigInt(budget.reservedAtomic) - amount).toString() : budget.reservedAtomic,
      }));
      const evaluation = evaluatePolicy({
        account,
        wallet: { id: wallet.id, status: wallet.status },
        intent: {
          type: "TRANSFER",
          atomicAmount: toAtomicString(claimed.atomicAmount),
          assetCode: claimed.assetCode,
          networkId: claimed.networkId,
          destination: claimed.destination,
        },
        budgets,
        policies,
      });
      return evaluation.decision === "DENY" ? `policy_${evaluation.reason}` : undefined;
    });
  }

  private async upsertSettlement(intentId: string, walletId: string, paymentIdHex: string) {
    await this.prisma.settlement.upsert({
      where: { intentId },
      create: { id: newId("settlement"), intentId, walletId, paymentIdHex, status: "PREPARING" },
      update: { status: "PREPARING" },
    });
  }

  private async recordAttempt(intentId: string, txHash: string, envelopeXdr: string | undefined) {
    const settlement = await this.prisma.settlement.findUniqueOrThrow({ where: { intentId } });
    const attemptCount = await this.prisma.chainTxAttempt.count({ where: { settlementId: settlement.id } });
    await this.prisma.chainTxAttempt.create({
      data: {
        id: newId("chainTx"),
        settlementId: settlement.id,
        attempt: attemptCount + 1,
        txHash,
        status: "SUBMITTED",
        ...(envelopeXdr !== undefined && { envelopeXdr }),
      },
    });
    await this.prisma.settlement.update({ where: { intentId }, data: { status: "SUBMITTED", txHash, submittedAt: new Date() } });
  }

  private async applyOutcome(intentId: string, outcome: SettlementOutcome) {
    if (outcome.status === "CONFIRMED") return this.handleConfirmed(intentId, outcome);
    if (outcome.status === "FAILED") return this.handleFailed(intentId, outcome);
    await this.markUnknown(intentId, outcome.reason);
  }

  private async handleConfirmed(
    intentId: string,
    outcome: Extract<SettlementOutcome, { status: "CONFIRMED" }>,
  ): Promise<void> {
    await this.reservations.commit(intentId, outcome.actualAtomic);
    await this.prisma.settlement.update({
      where: { intentId },
      data: {
        status: "CONFIRMED",
        txHash: outcome.txRef,
        actualAtomic: outcome.actualAtomic,
        confirmedAt: outcome.confirmedAt,
      },
    });
    await this.updateIntent(intentId, "COMPLETED");

    const intent = await this.prisma.financialIntent.findUniqueOrThrow({ where: { id: intentId } });
    await this.audit.record({
      accountId: intent.accountId,
      actorType: "SYSTEM",
      action: "PAYMENT_SETTLED",
      targetType: "intent",
      targetId: intentId,
      requestId: intent.requestId,
      payload: { txHash: outcome.txRef, actualAtomic: outcome.actualAtomic, alreadyExecuted: outcome.alreadyExecuted },
    });
  }

  private async handleFailed(
    intentId: string,
    outcome: Extract<SettlementOutcome, { status: "FAILED" }>,
  ): Promise<void> {
    await this.reservations.release(intentId);
    await this.prisma.settlement.update({
      where: { intentId },
      data: { status: "FAILED", failureCode: outcome.failureCode },
    });
    await this.updateIntent(intentId, "FAILED", outcome.failureCode);
  }

  private async markUnknown(intentId: string, reason: string) {
    await this.prisma.settlement
      .update({ where: { intentId }, data: { status: "UNKNOWN" } })
      .catch(() => undefined); // no Settlement row yet if prepare() itself threw before creating one
    this.logger.warn(`Intent ${intentId} settlement outcome is UNKNOWN: ${reason}. Reservation stays held.`);
  }

  private async updateIntent(intentId: string, status: "COMPLETED" | "FAILED", failureReason?: string) {
    await this.prisma.financialIntent.update({
      where: { id: intentId },
      data: { status, ...(failureReason !== undefined && { decisionReason: failureReason }) },
    });
  }
}
