import { Injectable, NotFoundException } from "@nestjs/common";
import type { Account, AgentWallet, Prisma } from "@paymod/database";
import { ReservationRepository, resolveDayWindow, resolveMonthWindow, type WindowSpec } from "@paymod/database";
import { evaluatePolicy, type PolicyEvaluation, type PolicyRule, type TraceEntry } from "@paymod/policy-engine";
import { isPaymodError, newId, parseAtomicAmount } from "@paymod/shared";
import { PrismaService } from "../common/prisma.service.js";
import { IdempotencyService } from "../common/idempotency.service.js";
import { AuditService } from "../audit/audit.service.js";
import { SettlementQueue } from "../settlement/settlement.queue.js";
import { loadPolicyRules, resolveBudgetScope, resolveBudgets } from "./budget-resolution.js";
import { ApprovalService } from "../approvals/approval.service.js";
import { TelegramService } from "../approvals/telegram.service.js";

export type TransferInput = {
  amount: string;
  destination: string;
  purpose?: string;
};

export type TransferResponse = {
  requestId: string;
  intentId: string;
  status: "AUTHORIZED" | "WAITING_APPROVAL" | "DENIED";
  reason?: string;
};

const INTENT_EXPIRY_MS = 60 * 60 * 1000;
/** approval TTL (10m) + settlement TTL (~2m) + retry budget: never hardcode this figure in two places. */
const RESERVATION_TTL_MS = 30 * 60 * 1000;

type TransferResult = { response: TransferResponse; intentId: string; shouldEnqueue: boolean; shouldNotify?: boolean };

/** everything the request-thread steps need, bundled so each takes (tx, ctx) rather than a long parameter list. */
type TransferContext = {
  account: Account;
  wallet: AgentWallet;
  input: TransferInput;
  requestId: string;
  intentId: string;
  idempotencyKey: string;
  assetCode: string;
  networkId: string;
};

@Injectable()
export class IntentsService {
  private readonly reservations: ReservationRepository;

  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
    private readonly queue: SettlementQueue,
    private readonly approvals: ApprovalService,
    private readonly telegram: TelegramService,
  ) {
    this.reservations = new ReservationRepository(prisma);
  }

  /**
   * Follows docs/BUILD_PLAN.md's settlement ordering, all inside one
   * transaction (budget stays reserved through REQUIRE_APPROVAL too, see
   * authorizeAndComplete). Enqueueing the settlement job happens only after
   * the transaction commits.
   */
  async createTransfer(
    account: Account,
    wallet: AgentWallet,
    idempotencyKey: string,
    input: TransferInput,
  ): Promise<TransferResponse> {
    const requestHash = this.idempotency.hashRequest(input);

    const { response, intentId, shouldEnqueue, shouldNotify = false } = await this.prisma.$transaction(async (tx) => {
      const outcome = await this.idempotency.beginOrReplay(tx, account.id, idempotencyKey, requestHash);
      if (outcome.kind === "replay") {
        const cached = outcome.response as TransferResponse;
        return { response: cached, intentId: cached.intentId, shouldEnqueue: false };
      }

      const asset = await tx.walletAsset.findFirst({ where: { walletId: wallet.id } });
      const ctx: TransferContext = {
        account,
        wallet,
        input,
        idempotencyKey,
        requestId: newId("request"),
        intentId: newId("intent"),
        assetCode: asset?.assetCode ?? "USDC",
        networkId: wallet.networkId ?? "stellar:testnet",
      };

      await this.createPendingIntent(tx, ctx);
      const policyRules = await loadPolicyRules(tx, account.id);
      const market = { accountId: account.id, walletId: wallet.id, assetCode: ctx.assetCode, networkId: ctx.networkId };
      const { budgetsForEngine, reserveWindows } = await resolveBudgets(this.reservations, tx, market, policyRules);
      const evaluation = evaluatePolicy({
        account: { id: account.id, status: account.status },
        wallet: { id: wallet.id, status: wallet.status },
        intent: {
          type: "TRANSFER",
          atomicAmount: input.amount,
          assetCode: ctx.assetCode,
          networkId: ctx.networkId,
          destination: input.destination,
        },
        budgets: budgetsForEngine,
        policies: policyRules,
      });

      if (evaluation.decision === "DENY") {
        return this.denyAndComplete(tx, ctx, outcome.recordId, evaluation.reason, evaluation.trace);
      }
      if (reserveWindows.length > 0) {
        const denied = await this.tryReserve(tx, ctx, reserveWindows, outcome.recordId);
        if (denied) return denied;
      }
      return this.authorizeAndComplete(tx, ctx, outcome.recordId, evaluation);
    });

    if (shouldEnqueue) {
      await this.queue.enqueue(intentId);
    }
    if (shouldNotify) await this.telegram.notifyApproval(intentId);
    return response;
  }

  private async createPendingIntent(tx: Prisma.TransactionClient, ctx: TransferContext): Promise<void> {
    await tx.financialIntent.create({
      data: {
        id: ctx.intentId,
        accountId: ctx.account.id,
        walletId: ctx.wallet.id,
        requestId: ctx.requestId,
        idempotencyKey: ctx.idempotencyKey,
        type: "TRANSFER",
        status: "PENDING",
        atomicAmount: ctx.input.amount,
        assetCode: ctx.assetCode,
        networkId: ctx.networkId,
        destination: ctx.input.destination,
        ...(ctx.input.purpose !== undefined && { purpose: ctx.input.purpose }),
        expiresAt: new Date(Date.now() + INTENT_EXPIRY_MS),
      },
    });
  }

  /** `trace` is omitted (not just empty) for a reservation-triggered denial, matching the original's shape exactly. */
  private async denyAndComplete(
    tx: Prisma.TransactionClient,
    ctx: TransferContext,
    recordId: string,
    reason: string,
    trace?: TraceEntry[],
  ): Promise<TransferResult> {
    await tx.financialIntent.update({
      where: { id: ctx.intentId },
      data: {
        status: "DENIED",
        decision: "DENY",
        decisionReason: reason,
        ...(trace !== undefined && { policyTrace: trace }),
      },
    });
    await this.audit.record(
      {
        accountId: ctx.account.id,
        actorType: "SPENDER",
        actorId: ctx.wallet.id,
        action: "INTENT_DENIED",
        targetType: "intent",
        targetId: ctx.intentId,
        requestId: ctx.requestId,
        payload: { reason },
      },
      tx,
    );
    const body: TransferResponse = { requestId: ctx.requestId, intentId: ctx.intentId, status: "DENIED", reason };
    await this.idempotency.complete(tx, recordId, ctx.intentId, body);
    return { response: body, intentId: ctx.intentId, shouldEnqueue: false };
  }

  /** returns a DENIED result on budget exhaustion or `undefined` to continue past reservation. */
  private async tryReserve(
    tx: Prisma.TransactionClient,
    ctx: TransferContext,
    reserveWindows: WindowSpec[],
    recordId: string,
  ): Promise<TransferResult | undefined> {
    try {
      await this.reservations.reserve(
        {
          accountId: ctx.account.id,
          walletId: ctx.wallet.id,
          intentId: ctx.intentId,
          requestId: ctx.requestId,
          idempotencyKey: ctx.idempotencyKey,
          amountAtomic: ctx.input.amount,
          expiresAt: new Date(Date.now() + RESERVATION_TTL_MS),
          windows: reserveWindows,
        },
        tx,
      );
      return undefined;
    } catch (error) {
      if (!isPaymodError(error)) throw error;
      return this.denyAndComplete(tx, ctx, recordId, error.code);
    }
  }

  /**
   * Holding budget during REQUIRE_APPROVAL is deliberate: otherwise a second
   * request could spend the money out from under a pending approval. A
   * Telegram approval request is created in the same transaction as the hold.
   */
  private async authorizeAndComplete(
    tx: Prisma.TransactionClient,
    ctx: TransferContext,
    recordId: string,
    evaluation: PolicyEvaluation,
  ): Promise<TransferResult> {
    const finalStatus = evaluation.decision === "REQUIRE_APPROVAL" ? "WAITING_APPROVAL" : "AUTHORIZED";
    await tx.financialIntent.update({
      where: { id: ctx.intentId },
      data: {
        status: finalStatus,
        decision: evaluation.decision,
        decisionReason: evaluation.reason,
        policyTrace: evaluation.trace,
      },
    });
    if (finalStatus === "WAITING_APPROVAL") {
      await this.approvals.createPending(tx, ctx.account.id, ctx.intentId);
    }
    await this.audit.record(
      {
        accountId: ctx.account.id,
        actorType: "SPENDER",
        actorId: ctx.wallet.id,
        action: `INTENT_${finalStatus}`,
        targetType: "intent",
        targetId: ctx.intentId,
        requestId: ctx.requestId,
      },
      tx,
    );

    const body: TransferResponse = {
      requestId: ctx.requestId,
      intentId: ctx.intentId,
      status: finalStatus,
      ...(finalStatus === "WAITING_APPROVAL" && { reason: evaluation.reason }),
    };
    await this.idempotency.complete(tx, recordId, ctx.intentId, body);
    return {
      response: body,
      intentId: ctx.intentId,
      shouldEnqueue: finalStatus === "AUTHORIZED",
      shouldNotify: finalStatus === "WAITING_APPROVAL",
    };
  }

  async getIntent(accountId: string, intentId: string) {
    const intent = await this.prisma.financialIntent.findFirst({
      where: { id: intentId, accountId },
      include: { settlement: true },
    });
    if (!intent) throw new NotFoundException(`Intent ${intentId} not found`);
    return intent;
  }

  /** read-only budget status per configured window. A window with no limit policy is simply absent. */
  async getBudget(account: Account, wallet: AgentWallet): Promise<BudgetWindowStatus[]> {
    const asset = await this.prisma.walletAsset.findFirst({ where: { walletId: wallet.id } });
    const market: BudgetMarket = {
      accountId: account.id,
      assetCode: asset?.assetCode ?? "USDC",
      networkId: wallet.networkId ?? "stellar:testnet",
    };

    const policyRules = await loadPolicyRules(this.prisma, account.id);
    const statuses: BudgetWindowStatus[] = [];

    const dayScope = resolveBudgetScope(policyRules, "DAILY_LIMIT", wallet.id);
    if (dayScope) statuses.push(await this.getWindowStatus(market, resolveDayWindow(), dayScope));

    const monthScope = resolveBudgetScope(policyRules, "MONTHLY_LIMIT", wallet.id);
    if (monthScope) statuses.push(await this.getWindowStatus(market, resolveMonthWindow(), monthScope));

    return statuses;
  }

  private async getWindowStatus(
    market: BudgetMarket,
    calendar: { window: "DAY" | "MONTH"; startsAt: Date; endsAt: Date },
    scope: { scopeWalletId: string | null; limitAtomic: string },
  ): Promise<BudgetWindowStatus> {
    const [existing] = await this.reservations.readBudgets(market.accountId, scope.scopeWalletId, [
      { window: calendar.window, assetCode: market.assetCode, networkId: market.networkId, startsAt: calendar.startsAt, endsAt: calendar.endsAt },
    ]);
    const spentAtomic = existing?.spentAtomic ?? "0";
    const reservedAtomic = existing?.reservedAtomic ?? "0";
    const limit = parseAtomicAmount(scope.limitAtomic);
    const committed = parseAtomicAmount(spentAtomic) + parseAtomicAmount(reservedAtomic);
    const availableAtomic = (limit > committed ? limit - committed : 0n).toString();
    return { window: calendar.window, limitAtomic: scope.limitAtomic, spentAtomic, reservedAtomic, availableAtomic };
  }
}

type BudgetMarket = { accountId: string; assetCode: string; networkId: string };

export type BudgetWindowStatus = {
  window: "DAY" | "MONTH";
  limitAtomic: string;
  spentAtomic: string;
  reservedAtomic: string;
  availableAtomic: string;
};
