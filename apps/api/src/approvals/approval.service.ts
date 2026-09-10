import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@paymod/database";
import { ReservationRepository } from "@paymod/database";
import { newId } from "@paymod/shared";
import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../common/prisma.service.js";
import { SettlementQueue } from "../settlement/settlement.queue.js";

@Injectable()
export class ApprovalService {
  private readonly reservations: ReservationRepository;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: SettlementQueue,
  ) {
    this.reservations = new ReservationRepository(prisma);
  }

  async createPending(tx: Prisma.TransactionClient, accountId: string, intentId: string) {
    return tx.approvalRequest.create({
      data: { id: newId("approval"), accountId, intentId, channel: "TELEGRAM" },
    });
  }

  async approve(id: string, accountId: string, telegramUserId: string): Promise<{ intentId: string; type: string }> {
    const resolved = await this.prisma.$transaction(async (tx) => {
      const approval = await tx.approvalRequest.findFirst({
        where: { id, accountId },
        include: { intent: true },
      });
      if (!approval) throw new NotFoundException("Approval request not found");
      if (approval.status !== "PENDING" || approval.intent.status !== "WAITING_APPROVAL") {
        throw new ConflictException("This approval is no longer pending");
      }
      if (approval.intent.expiresAt <= new Date()) throw new ConflictException("This approval has expired");

      const approvalUpdated = await tx.approvalRequest.updateMany({
        where: { id, status: "PENDING" },
        data: { status: "APPROVED", resolvedAt: new Date(), resolvedByTelegramUserId: telegramUserId },
      });
      if (approvalUpdated.count !== 1) throw new ConflictException("This approval is no longer pending");
      const intentUpdated = await tx.financialIntent.updateMany({
        where: { id: approval.intentId, status: "WAITING_APPROVAL" },
        data: { status: "AUTHORIZED" },
      });
      if (intentUpdated.count !== 1) throw new ConflictException("This approval is no longer pending");

      await this.audit.record(
        {
          accountId,
          actorType: "USER",
          action: "INTENT_APPROVED",
          targetType: "intent",
          targetId: approval.intentId,
          requestId: approval.intent.requestId,
          payload: { channel: "TELEGRAM", telegramUserId },
        },
        tx,
      );
      return { intentId: approval.intentId, type: approval.intent.type };
    });
    if (resolved.type === "TRANSFER") await this.queue.enqueue(resolved.intentId);
    return resolved;
  }

  async deny(id: string, accountId: string, telegramUserId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const approval = await tx.approvalRequest.findFirst({
        where: { id, accountId },
        include: { intent: true },
      });
      if (!approval) throw new NotFoundException("Approval request not found");
      if (approval.status !== "PENDING" || approval.intent.status !== "WAITING_APPROVAL") {
        throw new ConflictException("This approval is no longer pending");
      }
      const updated = await tx.approvalRequest.updateMany({
        where: { id, status: "PENDING" },
        data: { status: "DENIED", resolvedAt: new Date(), resolvedByTelegramUserId: telegramUserId },
      });
      if (updated.count !== 1) throw new ConflictException("This approval is no longer pending");
      await this.reservations.release(approval.intentId, "RELEASED", tx);
      await tx.financialIntent.updateMany({
        where: { id: approval.intentId, status: "WAITING_APPROVAL" },
        data: { status: "DENIED" },
      });
      await this.audit.record(
        {
          accountId,
          actorType: "USER",
          action: "INTENT_DENIED",
          targetType: "intent",
          targetId: approval.intentId,
          requestId: approval.intent.requestId,
          payload: { channel: "TELEGRAM", telegramUserId },
        },
        tx,
      );
    });
  }

  async expire(intentId: string): Promise<void> {
    await this.prisma.approvalRequest.updateMany({
      where: { intentId, status: "PENDING" },
      data: { status: "EXPIRED", resolvedAt: new Date() },
    });
  }
}
