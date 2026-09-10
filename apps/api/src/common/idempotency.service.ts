import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { Prisma } from "@paymod/database";
import { ERROR_CODES, PaymodError, newId } from "@paymod/shared";

export type IdempotencyOutcome =
  | { kind: "new"; recordId: string }
  | { kind: "replay"; response: unknown };

const IDEMPOTENCY_RECORD_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Deliberately not an HTTP interceptor. Idempotency must be checked and
 * reserved inside the SAME database transaction as intent creation: an
 * interceptor wrapping the request would leave a race window where two
 * concurrent identical requests both miss the lookup and both create an
 * intent. Called from within `prisma.$transaction` in IntentsService.
 */
@Injectable()
export class IdempotencyService {
  hashRequest(body: unknown): string {
    return createHash("sha256").update(JSON.stringify(body)).digest("hex");
  }

  async beginOrReplay(
    tx: Prisma.TransactionClient,
    accountId: string,
    key: string,
    requestHash: string,
  ): Promise<IdempotencyOutcome> {
    const existing = await tx.idempotencyRecord.findUnique({
      where: { accountId_key: { accountId, key } },
    });

    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new PaymodError(
          ERROR_CODES.IDEMPOTENCY_CONFLICT,
          "This idempotency key was already used with a different request body.",
          { httpStatus: 409 },
        );
      }
      // A record with no response yet means the original request is still
      // in flight in another process. Treat as a conflict rather than racing
      // to write a second response snapshot for the same key.
      if (existing.responseSnapshot === null) {
        throw new PaymodError(
          ERROR_CODES.IDEMPOTENCY_CONFLICT,
          "A request with this idempotency key is already being processed.",
          { httpStatus: 409 },
        );
      }
      return { kind: "replay", response: existing.responseSnapshot };
    }

    const recordId = newId("request");
    await tx.idempotencyRecord.create({
      data: {
        id: recordId,
        accountId,
        key,
        requestHash,
        responseSnapshot: undefined,
        expiresAt: new Date(Date.now() + IDEMPOTENCY_RECORD_TTL_MS),
      },
    });
    return { kind: "new", recordId };
  }

  async complete(
    tx: Prisma.TransactionClient,
    recordId: string,
    intentId: string,
    response: unknown,
  ): Promise<void> {
    await tx.idempotencyRecord.update({
      where: { id: recordId },
      data: { intentId, responseSnapshot: response as Prisma.InputJsonValue },
    });
  }
}
