import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ReservationRepository } from "@paymod/database";
import { isPaymentExecuted } from "@paymod/stellar";
import { isSafeToRelease, type PaymentRail } from "@paymod/payments";
import { Server } from "@stellar/stellar-sdk/rpc";
import { PrismaService } from "../common/prisma.service.js";
import { SettlementQueue } from "./settlement.queue.js";
import { getStellarNetworkPassphrase, getStellarRpcUrl } from "./stellar-config.js";
import { PAYMENT_RAIL } from "./payment-rail.token.js";

const SWEEP_INTERVAL_MS = 30_000;
/** matches SettlementService's CLAIM_LEASE_MS; a PROCESSING intent past this is presumed abandoned. */
const STUCK_LEASE_MS = 2 * 60 * 1000;

/**
 * Reconciliation, driven from Postgres state, never from queue state.
 * Expiry never races a payment on the wire: `expireDue()` refuses anything
 * with a SUBMITTED/UNKNOWN chain attempt. Retries are always safe: the
 * deterministic payment id means retrying an already-landed payment
 * surfaces as `PaymentAlreadyExecutedError`, never a double-pay.
 */
@Injectable()
export class SettlementSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SettlementSweeper.name);
  private readonly reservations: ReservationRepository;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: SettlementQueue,
    @Inject(PAYMENT_RAIL) private readonly rail: PaymentRail,
  ) {
    this.reservations = new ReservationRepository(prisma);
  }

  onModuleInit() {
    this.timer = setInterval(() => {
      this.sweep().catch((err) => this.logger.error(`Sweep failed: ${(err as Error).message}`));
    }, SWEEP_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(): Promise<{ expired: string[]; retried: string[]; reconciled: string[] }> {
    const expired = await this.expireStaleReservations();
    const reconciled = await this.reconcileUnknownSettlements();
    const retried = await this.retryStuckIntents();
    return { expired, retried, reconciled };
  }

  private async expireStaleReservations(): Promise<string[]> {
    const expiredIntentIds = await this.reservations.expireDue();
    for (const intentId of expiredIntentIds) {
      await this.prisma.financialIntent.updateMany({
        where: { id: intentId, status: { in: ["AUTHORIZED", "WAITING_APPROVAL"] } },
        data: { status: "EXPIRED" },
      });
      await this.prisma.approvalRequest.updateMany({
        where: { intentId, status: "PENDING" },
        data: { status: "EXPIRED", resolvedAt: new Date() },
      });
    }
    if (expiredIntentIds.length > 0) {
      this.logger.log(`Expired ${expiredIntentIds.length} stale reservation(s): ${expiredIntentIds.join(", ")}`);
    }
    return expiredIntentIds;
  }

  /**
   * `type: "TRANSFER"` is load-bearing, not a tidy-up: an X402_PAYMENT
   * settles synchronously inside `X402Service`, never through
   * `execute_payment`. Re-enqueueing one here would pay the merchant with no
   * x402 handshake - the deterministic paymentId stops that from
   * double-spending, but not from being the wrong payment.
   */
  private async retryStuckIntents(): Promise<string[]> {
    const missedEnqueue = await this.prisma.financialIntent.findMany({
      where: { type: "TRANSFER", status: "AUTHORIZED", settlement: null },
      select: { id: true },
    });
    const staleLease = await this.prisma.financialIntent.findMany({
      where: { type: "TRANSFER", status: "PROCESSING", lockedAt: { lt: new Date(Date.now() - STUCK_LEASE_MS) } },
      select: { id: true },
    });

    const retried = [...missedEnqueue, ...staleLease].map((i) => i.id);
    for (const intentId of retried) {
      await this.queue.enqueueRetry(intentId);
    }
    if (retried.length > 0) {
      this.logger.log(`Re-enqueued ${retried.length} stuck intent(s): ${retried.join(", ")}`);
    }
    return retried;
  }

  private async reconcileUnknownSettlements(): Promise<string[]> {
    const unknown = await this.prisma.settlement.findMany({
      where: { status: "UNKNOWN", intent: { type: "TRANSFER" } },
      include: { intent: true, wallet: true },
    });
    const reconciled: string[] = [];

    for (const settlement of unknown) {
      try {
        const outcome = settlement.wallet.contractId
          ? await this.reconcileStellar(settlement.wallet.contractId, settlement.paymentIdHex)
          : await this.reconcileViaRail(settlement);
        if (outcome === "CONFIRMED") {
          await this.reservations.commit(settlement.intentId, settlement.intent.atomicAmount.toFixed(0));
          await this.prisma.$transaction([
            this.prisma.settlement.update({
              where: { id: settlement.id },
              data: { status: "CONFIRMED", actualAtomic: settlement.intent.atomicAmount, confirmedAt: new Date() },
            }),
            this.prisma.financialIntent.update({ where: { id: settlement.intentId }, data: { status: "COMPLETED" } }),
          ]);
          reconciled.push(settlement.intentId);
        } else if (outcome === "FAILED") {
          await this.reservations.release(settlement.intentId);
          await this.prisma.$transaction([
            this.prisma.settlement.update({ where: { id: settlement.id }, data: { status: "FAILED" } }),
            this.prisma.financialIntent.update({ where: { id: settlement.intentId }, data: { status: "FAILED" } }),
          ]);
          reconciled.push(settlement.intentId);
        }
      } catch (error) {
        this.logger.warn(`Could not reconcile ${settlement.intentId}: ${(error as Error).message}`);
      }
    }
    return reconciled;
  }

  /** dormant path, kept for Stellar's future re-expansion - not exercised while Circle is the only active rail. */
  private async reconcileStellar(contractId: string, paymentIdHex: string): Promise<"CONFIRMED" | undefined> {
    const server = new Server(getStellarRpcUrl());
    const executed = await isPaymentExecuted(server, contractId, getStellarNetworkPassphrase(), Buffer.from(paymentIdHex, "hex"));
    return executed ? "CONFIRMED" : undefined;
  }

  /**
   * the active path. Never trusts the settlement row's own `status` - always
   * re-derives the outcome from the rail's `confirm()`, the same call
   * `SettlementService` itself makes, so reconciliation can never disagree
   * with the primary settlement path about what a given outcome means.
   */
  private async reconcileViaRail(
    settlement: Awaited<ReturnType<typeof this.prisma.settlement.findMany>>[number] & {
      intent: { networkId: string; atomicAmount: { toFixed: (digits: number) => string } };
    },
  ): Promise<"CONFIRMED" | "FAILED" | undefined> {
    if (!settlement.txHash) return undefined;
    const outcome = await this.rail.confirm({
      intentId: settlement.intentId,
      networkId: settlement.intent.networkId,
      paymentId: settlement.paymentIdHex,
      requestedAtomicAmount: settlement.intent.atomicAmount.toFixed(0),
      txRef: settlement.txHash,
      submittedAt: settlement.submittedAt ?? settlement.createdAt,
    });
    if (outcome.status === "CONFIRMED") return "CONFIRMED";
    if (isSafeToRelease(outcome)) return "FAILED";
    return undefined;
  }
}
