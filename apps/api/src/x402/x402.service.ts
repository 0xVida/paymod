import { Inject, Injectable } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import type { Account, AgentWallet, Prisma, WalletAsset } from "@paymod/database";
import { ReservationRepository } from "@paymod/database";
import { evaluatePolicy, type PolicyRule } from "@paymod/policy-engine";
import { ERROR_CODES, PaymodError, newId, parseAtomicAmount } from "@paymod/shared";
import {
  encodePaymentSignatureHeader,
  parsePaymentRequiredResponse,
  parsePaymentResponse,
  paymentSignatureHeaderName,
  selectStellarExactRequirement,
  selectEvmExactRequirement,
  ssrfSafeFetch,
  type PaymentRequirements,
} from "@paymod/x402";
import { buildSignedX402Transaction, derivePaymentId, isPaymentExecuted } from "@paymod/stellar";
import { signTransferAuthorization, isAuthorizationUsed } from "@paymod/circle";
import { PrismaService } from "../common/prisma.service.js";
import { AuditService } from "../audit/audit.service.js";
import { loadPolicyRules, resolveBudgets } from "../intents/budget-resolution.js";
import { STELLAR_X402_SIGNER, type StellarX402Signer } from "./stellar-x402.provider.js";
import { CIRCLE_X402_SIGNER, type CircleX402Signer } from "./circle-x402.provider.js";
import { ApprovalService } from "../approvals/approval.service.js";
import { TelegramService } from "../approvals/telegram.service.js";

const INTENT_EXPIRY_MS = 5 * 60 * 1000; // x402 pays synchronously - no long approval wait to size for
const RESERVATION_TTL_MS = 5 * 60 * 1000;

export type X402FetchResult =
  | { status: "FETCHED_DIRECTLY"; httpStatus: number; contentType: string | null; body: string }
  | { status: "COMPLETED"; intentId: string; httpStatus: number; contentType: string | null; body: string; txHash: string; amountAtomic: string }
  | { status: "DENIED"; intentId: string; reason: string }
  | { status: "WAITING_APPROVAL"; intentId: string; reason: string }
  | { status: "FAILED"; intentId: string; reason: string }
  | { status: "UNKNOWN"; intentId: string; reason: string };

type WalletWithAssets = AgentWallet & { assets: WalletAsset[] };

/** everything the request needs, bundled once the merchant's price is known */
export type X402Context = {
  account: Account;
  wallet: WalletWithAssets;
  requirement: PaymentRequirements;
  url: string;
  requestId: string;
  intentId: string;
};

type AuthorizeResult =
  | { decision: "ALLOW"; ctx: X402Context }
  | { decision: "DENY"; intentId: string; reason: string }
  | { decision: "REQUIRE_APPROVAL"; intentId: string; reason: string };

/**
 * `POST /v1/x402/fetch` - the only rail where the amount is unknown until
 * the merchant responds. runs within one HTTP request rather than
 * `IntentsService`'s async settlement queue - the caller is synchronously
 * waiting and the facilitator's own settlement is fast (~5s), so deferring
 * to a worker gains nothing. otherwise the identical policy -> reserve ->
 * approve -> settle path (docs/BUILD_PLAN.md, ADR 0008), sharing
 * `evaluatePolicy` and `ReservationRepository` with `IntentsService`.
 */
@Injectable()
export class X402Service {
  private readonly reservations: ReservationRepository;

  /**
   * `TelegramService` is resolved lazily via `ModuleRef`, not constructor
   * injection - X402Service and TelegramService import each other directly,
   * and under this repo's native ESM (`module: NodeNext`, run via tsx) a
   * constructor-typed circular reference throws `ReferenceError: Cannot
   * access 'TelegramService' before initialization` at module-load time.
   * `forwardRef()` doesn't fix this - `emitDecoratorMetadata` still embeds
   * the raw class reference in `design:paramtypes`, read synchronously
   * before the circularly-imported module finishes evaluating. ESM's TDZ
   * throws on that read - CommonJS would have silently tolerated it as
   * `undefined`. `ModuleRef.get()` inside a method defers the read until
   * both modules have finished loading.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(STELLAR_X402_SIGNER) private readonly signer: StellarX402Signer,
    @Inject(CIRCLE_X402_SIGNER) private readonly circleSigner: CircleX402Signer,
    private readonly approvals: ApprovalService,
    private readonly moduleRef: ModuleRef,
  ) {
    this.reservations = new ReservationRepository(prisma);
  }

  private get telegram(): TelegramService {
    return this.moduleRef.get(TelegramService, { strict: false });
  }

  async fetch(account: Account, wallet: AgentWallet, url: string): Promise<X402FetchResult> {
    const initial = await ssrfSafeFetch(url, { method: "GET" });
    if (initial.status !== 402) {
      return { status: "FETCHED_DIRECTLY", ...(await readResourceBody(initial)) };
    }

    const required = parsePaymentRequiredResponse(initial);
    const fullWallet = await this.loadWalletAssets(wallet);
    // Stellar's own contractId is dormant while Circle is the active rail -
    // this branch exists so a future re-activated Stellar wallet keeps
    // working, not because both are live today.
    const requirement = fullWallet.contractId
      ? selectStellarExactRequirement(required, {
          networkId: fullWallet.networkId ?? "stellar:testnet",
          // non-null - loadWalletAssets already rejected a missing contractAddress above
          tokenContractId: fullWallet.assets[0]!.contractAddress!,
        })
      : selectEvmExactRequirement(required, {
          // non-null - every Circle-rail wallet gets networkId set at provisioning
          networkId: fullWallet.networkId!,
          // the real on-chain USDC address, not `assets[0].contractAddress`
          // (Circle's internal token id for API calls, a different
          // identifier for the same token). x402 requirement matching
          // needs the contract address, like every other implementation.
          tokenAddress: this.circleSigner.tokenAddress,
        });

    const authorized = await this.prisma.$transaction((tx) =>
      this.authorize(tx, { account, wallet: fullWallet, requirement, url, requestId: newId("request"), intentId: newId("intent") }),
    );
    if (authorized.decision !== "ALLOW") {
      if (authorized.decision === "REQUIRE_APPROVAL") await this.telegram.notifyApproval(authorized.intentId);
      return { status: authorized.decision === "DENY" ? "DENIED" : "WAITING_APPROVAL", intentId: authorized.intentId, reason: authorized.reason };
    }

    return this.pay(authorized.ctx);
  }

  private async loadWalletAssets(wallet: AgentWallet): Promise<WalletWithAssets> {
    const assets = await this.prisma.walletAsset.findMany({ where: { walletId: wallet.id } });
    if (assets.length === 0) {
      throw new PaymodError(ERROR_CODES.WALLET_UNVERIFIED, "This wallet has no configured asset yet");
    }
    if (!assets[0]!.contractAddress) {
      throw new PaymodError(ERROR_CODES.WALLET_UNVERIFIED, "This wallet's asset has no deployed contract yet");
    }
    return { ...wallet, assets };
  }

  private async authorize(tx: Prisma.TransactionClient, ctx: X402Context): Promise<AuthorizeResult> {
    await this.createPendingIntent(tx, ctx);
    const policyRules = await loadPolicyRules(tx, ctx.account.id);
    const market = { accountId: ctx.account.id, walletId: ctx.wallet.id, assetCode: ctx.wallet.assets[0]!.assetCode, networkId: ctx.wallet.networkId ?? "stellar:testnet" };
    const { budgetsForEngine, reserveWindows } = await resolveBudgets(this.reservations, tx, market, policyRules);

    const evaluation = evaluatePolicy({
      account: { id: ctx.account.id, status: ctx.account.status },
      wallet: { id: ctx.wallet.id, status: ctx.wallet.status },
      intent: {
        type: "X402_PAYMENT",
        atomicAmount: ctx.requirement.amount,
        assetCode: market.assetCode,
        networkId: market.networkId,
        destination: ctx.requirement.payTo,
      },
      budgets: budgetsForEngine,
      policies: policyRules as PolicyRule[],
    });

    if (evaluation.decision === "DENY") {
      return this.deny(tx, ctx, evaluation.reason, evaluation.trace);
    }
    if (reserveWindows.length > 0) {
      const denied = await this.tryReserve(tx, ctx, reserveWindows);
      if (denied) return denied;
    }
    if (evaluation.decision === "REQUIRE_APPROVAL") {
      await tx.financialIntent.update({ where: { id: ctx.intentId }, data: { status: "WAITING_APPROVAL", decision: "REQUIRE_APPROVAL", decisionReason: evaluation.reason, policyTrace: evaluation.trace } });
      await this.approvals.createPending(tx, ctx.account.id, ctx.intentId);
      return { decision: "REQUIRE_APPROVAL", intentId: ctx.intentId, reason: evaluation.reason };
    }
    await tx.financialIntent.update({ where: { id: ctx.intentId }, data: { status: "AUTHORIZED", decision: "ALLOW", decisionReason: evaluation.reason, policyTrace: evaluation.trace } });
    return { decision: "ALLOW", ctx };
  }

  private async createPendingIntent(tx: Prisma.TransactionClient, ctx: X402Context): Promise<void> {
    await tx.financialIntent.create({
      data: {
        id: ctx.intentId,
        accountId: ctx.account.id,
        walletId: ctx.wallet.id,
        requestId: ctx.requestId,
        idempotencyKey: ctx.intentId, // x402 has no client-supplied idempotency key - the intent id already is one
        type: "X402_PAYMENT",
        status: "PENDING",
        atomicAmount: ctx.requirement.amount,
        assetCode: ctx.wallet.assets[0]!.assetCode,
        networkId: ctx.wallet.networkId ?? "stellar:testnet",
        destination: ctx.requirement.payTo,
        metadata: JSON.parse(JSON.stringify({ url: ctx.url, requirement: ctx.requirement })) as Prisma.InputJsonValue,
        expiresAt: new Date(Date.now() + INTENT_EXPIRY_MS),
      },
    });
  }

  private async deny(tx: Prisma.TransactionClient, ctx: X402Context, reason: string, trace?: unknown): Promise<AuthorizeResult> {
    await tx.financialIntent.update({
      where: { id: ctx.intentId },
      data: { status: "DENIED", decision: "DENY", decisionReason: reason, ...(trace !== undefined && { policyTrace: trace as Prisma.InputJsonValue }) },
    });
    await this.audit.record(
      { accountId: ctx.account.id, actorType: "SPENDER", actorId: ctx.wallet.id, action: "INTENT_DENIED", targetType: "intent", targetId: ctx.intentId, requestId: ctx.requestId, payload: { reason } },
      tx,
    );
    return { decision: "DENY", intentId: ctx.intentId, reason };
  }

  private async tryReserve(
    tx: Prisma.TransactionClient,
    ctx: X402Context,
    reserveWindows: Parameters<ReservationRepository["reserve"]>[0]["windows"],
  ): Promise<AuthorizeResult | undefined> {
    try {
      await this.reservations.reserve(
        {
          accountId: ctx.account.id,
          walletId: ctx.wallet.id,
          intentId: ctx.intentId,
          requestId: ctx.requestId,
          idempotencyKey: ctx.intentId,
          amountAtomic: ctx.requirement.amount,
          expiresAt: new Date(Date.now() + RESERVATION_TTL_MS),
          windows: reserveWindows,
        },
        tx,
      );
      return undefined;
    } catch (error) {
      if (!(error instanceof PaymodError)) throw error;
      return this.deny(tx, ctx, error.code);
    }
  }

  /**
   * the payment step. mirrors `SettlementService`'s invariant exactly -
   * reserved -> spent only on a proven-successful settlement, reserved ->
   * released only on a proven-failed one, anything ambiguous stays reserved.
   */
  private async pay(ctx: X402Context): Promise<X402FetchResult> {
    // claim the intent before anything can move money. left in AUTHORIZED,
    // it's exposed on two fronts - the sweeper looks for AUTHORIZED intents
    // with no settlement row, and `expireDue` releases lapsed reservations
    // for anything not PROCESSING. either could free the budget for a
    // payment that may have already landed, the exact "released without
    // proven non-execution" case the reservation invariant forbids.
    await this.prisma.financialIntent.update({ where: { id: ctx.intentId }, data: { status: "PROCESSING", lockedAt: new Date() } });

    const built = await this.buildPaymentPayload(ctx);
    if (!built.ok) return this.markUnknown(ctx, built.reason);

    const header = encodePaymentSignatureHeader(ctx.requirement, built.payload, { url: ctx.url });
    let paid: Awaited<ReturnType<typeof ssrfSafeFetch>>;
    try {
      paid = await ssrfSafeFetch(ctx.url, { method: "GET", headers: { [paymentSignatureHeaderName()]: header } });
    } catch (error) {
      return this.markUnknown(ctx, `Payment retry request failed: ${(error as Error).message}`);
    }

    return this.applySettlementOutcome(ctx, paid);
  }

  /**
   * the paymentId derived from `ctx.intentId` doubles as the EIP-3009 nonce
   * on the Circle path (`0x` + the same 32 bytes Stellar's `paymentIdHex`
   * uses), deterministic across retries. `pay()` can run more than once per
   * intent (a reconciler retry after an ambiguous outcome) - a fresh random
   * nonce each time would sign a second, independently payable authorization
   * instead of retrying the same one.
   */
  private async buildPaymentPayload(ctx: X402Context): Promise<{ ok: true; payload: Parameters<typeof encodePaymentSignatureHeader>[1] } | { ok: false; reason: string }> {
    const paymentId = derivePaymentId(ctx.intentId);

    if (ctx.wallet.contractId) {
      try {
        const transaction = await buildSignedX402Transaction({
          server: this.signer.server,
          networkPassphrase: this.signer.networkPassphrase,
          treasuryContractId: ctx.wallet.contractId,
          tokenContractId: ctx.requirement.asset,
          destination: ctx.requirement.payTo,
          atomicAmount: parseAtomicAmount(ctx.requirement.amount),
          paymentId,
          executor: this.signer.executor,
          relayer: this.signer.relayer,
          maxTimeoutSeconds: ctx.requirement.maxTimeoutSeconds,
        });
        return { ok: true, payload: { transaction } };
      } catch (error) {
        return { ok: false, reason: `Failed to build the signed payment transaction: ${(error as Error).message}` };
      }
    }

    const name = ctx.requirement.extra?.["name"];
    const version = ctx.requirement.extra?.["version"];
    if (typeof name !== "string" || typeof version !== "string") {
      // shouldn't happen - selectEvmExactRequirement already validated this
      // at requirement-selection time. re-checked here because `ctx` travels
      // through a JSON round-trip via `resume()`/`reconcileUnknown()`,
      // which erases that earlier compile-time narrowing.
      return { ok: false, reason: "Requirement is missing extra.name/extra.version, required to sign an eip3009 authorization" };
    }
    if (!ctx.wallet.ownerAddress) {
      return { ok: false, reason: "Wallet has no on-chain address yet" };
    }

    try {
      const payload = await signTransferAuthorization({
        client: this.circleSigner.client,
        walletId: ctx.wallet.externalWalletId!,
        entitySecretHex: this.circleSigner.entitySecretHex,
        entityPublicKeyPem: this.circleSigner.entityPublicKeyPem,
        chainId: this.circleSigner.chainId,
        tokenAddress: ctx.requirement.asset,
        tokenName: name,
        tokenVersion: version,
        from: ctx.wallet.ownerAddress,
        to: ctx.requirement.payTo,
        atomicAmount: ctx.requirement.amount,
        maxTimeoutSeconds: ctx.requirement.maxTimeoutSeconds,
        nonce: `0x${paymentId.toString("hex")}`,
      });
      return { ok: true, payload };
    } catch (error) {
      return { ok: false, reason: `Failed to sign the eip3009 transfer authorization: ${(error as Error).message}` };
    }
  }

  private async applySettlementOutcome(ctx: X402Context, paid: Awaited<ReturnType<typeof ssrfSafeFetch>>): Promise<X402FetchResult> {
    let settlement: ReturnType<typeof parsePaymentResponse> | undefined;
    try {
      settlement = parsePaymentResponse(paid);
    } catch {
      settlement = undefined;
    }

    if (settlement?.success === true) {
      await this.reservations.commit(ctx.intentId, ctx.requirement.amount);
      await this.recordSettlement(ctx, settlement.transaction);
      await this.prisma.financialIntent.update({ where: { id: ctx.intentId }, data: { status: "COMPLETED" } });
      const resource = await readResourceBody(paid);
      return { status: "COMPLETED", intentId: ctx.intentId, txHash: settlement.transaction, amountAtomic: ctx.requirement.amount, ...resource };
    }

    if (settlement?.success === false) {
      // the facilitator proved the transfer didn't execute - safe to release
      await this.reservations.release(ctx.intentId);
      const reason = settlement.errorReason ?? `merchant refused payment (HTTP ${paid.status})`;
      await this.prisma.financialIntent.update({ where: { id: ctx.intentId }, data: { status: "FAILED", decisionReason: reason } });
      return { status: "FAILED", intentId: ctx.intentId, reason };
    }

    // no parseable PAYMENT-RESPONSE - we can't prove the payment didn't
    // land, so it stays reserved rather than risk a double-pay on retry.
    return this.markUnknown(ctx, `Merchant returned HTTP ${paid.status} with no valid PAYMENT-RESPONSE header`);
  }

  private async recordSettlement(ctx: X402Context, txHash: string): Promise<void> {
    await this.prisma.settlement.create({
      data: {
        id: newId("settlement"),
        intentId: ctx.intentId,
        walletId: ctx.wallet.id,
        paymentIdHex: derivePaymentId(ctx.intentId).toString("hex"),
        status: "CONFIRMED",
        txHash,
        actualAtomic: ctx.requirement.amount,
        confirmedAt: new Date(),
      },
    });
    await this.audit.record({
      accountId: ctx.account.id,
      actorType: "SYSTEM",
      action: "PAYMENT_SETTLED",
      targetType: "intent",
      targetId: ctx.intentId,
      requestId: ctx.requestId,
      payload: { txHash, actualAtomic: ctx.requirement.amount, rail: "x402" },
    });
  }

  private async markUnknown(ctx: X402Context, reason: string): Promise<X402FetchResult> {
    await this.prisma.financialIntent.update({ where: { id: ctx.intentId }, data: { status: "PROCESSING" } }).catch(() => undefined);
    await this.audit.record({
      accountId: ctx.account.id,
      actorType: "SYSTEM",
      action: "X402_SETTLEMENT_UNKNOWN",
      targetType: "intent",
      targetId: ctx.intentId,
      requestId: ctx.requestId,
      payload: { reason },
    });
    return { status: "UNKNOWN", intentId: ctx.intentId, reason };
  }

  async resume(intentId: string): Promise<void> {
    const intent = await this.prisma.financialIntent.findUnique({
      where: { id: intentId },
      include: { account: true, wallet: { include: { assets: true } } },
    });
    if (!intent || intent.type !== "X402_PAYMENT" || intent.status !== "AUTHORIZED") return;
    const metadata = intent.metadata as { url?: unknown; requirement?: unknown };
    const isProvisioned = !!intent.wallet.contractId || !!intent.wallet.externalWalletId;
    if (typeof metadata.url !== "string" || !metadata.requirement || !isProvisioned) {
      await this.reservations.release(intentId);
      await this.prisma.financialIntent.update({ where: { id: intentId }, data: { status: "FAILED", decisionReason: "x402 continuation data is unavailable" } });
      return;
    }
    const ctx: X402Context = {
      account: intent.account,
      wallet: intent.wallet,
      requirement: metadata.requirement as PaymentRequirements,
      url: metadata.url,
      requestId: intent.requestId,
      intentId: intent.id,
    };
    const result = await this.pay(ctx);
    await this.prisma.financialIntent.update({
      where: { id: intentId },
      data: { metadata: JSON.parse(JSON.stringify({ ...metadata, continuationResult: result })) as Prisma.InputJsonValue },
    });
  }

  async getResult(walletId: string, intentId: string): Promise<unknown | null> {
    const intent = await this.prisma.financialIntent.findFirst({
      where: { id: intentId, walletId, type: "X402_PAYMENT" },
      select: { metadata: true },
    });
    if (!intent) return null;
    const metadata = intent.metadata as { continuationResult?: unknown };
    return metadata.continuationResult ?? null;
  }

  /**
   * `paymentId` is reused as the EIP-3009 nonce (`buildPaymentPayload` signs
   * with `0x` + this same hex), so checking whether it's been consumed
   * on-chain answers the same "has this payment already landed" question
   * `isPaymentExecuted` answers for Stellar, just via `authorizationState`
   * instead of a contract-specific replay slot.
   */
  private async circleAuthorizationExecuted(ownerAddress: string | null, paymentId: Buffer): Promise<boolean> {
    if (!ownerAddress) return false;
    const nonce = `0x${paymentId.toString("hex")}`;
    return isAuthorizationUsed(this.circleSigner.rpcUrl, this.circleSigner.tokenAddress, ownerAddress, nonce);
  }

  async reconcileUnknown(intentId: string): Promise<"CONFIRMED" | "RETRIED" | "SKIPPED"> {
    const intent = await this.prisma.financialIntent.findUnique({
      where: { id: intentId },
      include: { account: true, wallet: { include: { assets: true } } },
    });
    if (!intent || intent.type !== "X402_PAYMENT" || intent.status !== "PROCESSING") return "SKIPPED";
    if (!intent.wallet.contractId && !intent.wallet.externalWalletId) return "SKIPPED";
    const metadata = intent.metadata as { url?: unknown; requirement?: unknown };
    if (typeof metadata.url !== "string" || !metadata.requirement) return "SKIPPED";
    const paymentId = derivePaymentId(intent.id);
    const executed = intent.wallet.contractId
      ? await isPaymentExecuted(this.signer.server, intent.wallet.contractId, this.signer.networkPassphrase, paymentId)
      : await this.circleAuthorizationExecuted(intent.wallet.ownerAddress, paymentId);
    if (executed) {
      await this.reservations.commit(intent.id, intent.atomicAmount.toFixed(0));
      await this.prisma.$transaction([
        this.prisma.settlement.upsert({
          where: { intentId: intent.id },
          create: { id: newId("settlement"), intentId: intent.id, walletId: intent.walletId, paymentIdHex: paymentId.toString("hex"), status: "CONFIRMED", actualAtomic: intent.atomicAmount, confirmedAt: new Date() },
          update: { status: "CONFIRMED", actualAtomic: intent.atomicAmount, confirmedAt: new Date() },
        }),
        this.prisma.financialIntent.update({ where: { id: intent.id }, data: { status: "COMPLETED" } }),
      ]);
      return "CONFIRMED";
    }
    const ctx: X402Context = {
      account: intent.account,
      wallet: intent.wallet,
      requirement: metadata.requirement as PaymentRequirements,
      url: metadata.url,
      requestId: intent.requestId,
      intentId: intent.id,
    };
    const result = await this.pay(ctx);
    await this.prisma.financialIntent.update({
      where: { id: intent.id },
      data: { metadata: JSON.parse(JSON.stringify({ ...metadata, continuationResult: result })) as Prisma.InputJsonValue },
    });
    return "RETRIED";
  }
}

async function readResourceBody(response: Response): Promise<{ httpStatus: number; contentType: string | null; body: string }> {
  return { httpStatus: response.status, contentType: response.headers.get("content-type"), body: await response.text() };
}
