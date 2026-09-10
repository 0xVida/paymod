import { Injectable } from "@nestjs/common";
import type { PrismaClient, Prisma } from "@paymod/database";
import { newId } from "@paymod/shared";
import { PrismaService } from "../common/prisma.service.js";

export type AuditEntry = {
  accountId: string;
  actorType: "SYSTEM" | "SPENDER" | "USER";
  actorId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  requestId?: string;
  payload?: Record<string, unknown>;
};

/**
 * Append-only by construction (see the DB trigger in the reservation
 * migration): this service only ever inserts. Accepts either the default
 * client or a transaction client so a caller can write the audit row in the
 * same transaction as the state change it describes.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry, client: PrismaClient | Prisma.TransactionClient = this.prisma) {
    await client.auditEvent.create({
      data: {
        id: newId("auditEvent"),
        accountId: entry.accountId,
        actorType: entry.actorType,
        ...(entry.actorId !== undefined && { actorId: entry.actorId }),
        action: entry.action,
        ...(entry.targetType !== undefined && { targetType: entry.targetType }),
        ...(entry.targetId !== undefined && { targetId: entry.targetId }),
        ...(entry.requestId !== undefined && { requestId: entry.requestId }),
        payload: (entry.payload ?? {}) as Prisma.InputJsonValue,
      },
    });
  }
}
