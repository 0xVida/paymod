import { Prisma, type PrismaClient } from "@prisma/client";
import { newId } from "@paymod/shared";

/**
 * debit-side concurrency for Paymod Code usage (PAYMOD_CODE_PLAN.md
 * section 2). `code_account_balances` mirrors `reservations.ts`'s
 * technique for `budget_periods` - one guarded conditional `UPDATE` per
 * operation inside a transaction, so concurrent reservations against a
 * near-exhausted balance serialize on the row lock and exactly one wins.
 *
 *   RESERVED -> COMMITTED               only on a real, known charge
 *   RESERVED -> RELEASED / EXPIRED      only on proven non-execution
 *   RESERVED -> RECONCILIATION_REQUIRED terminal usage unknown, stays held
 */
export type InferenceProvider = "OPENAI" | "ANTHROPIC";

export type ReserveUsageInput = {
  accountId: string;
  sessionId: string;
  taskId: string;
  provider: InferenceProvider;
  model: string;
  pricingVersion: number;
  estimatedAtomic: string;
};

export type ReserveUsageResult = { ok: true; reservationId: string } | { ok: false; reason: "INSUFFICIENT_BALANCE" };

/** raw drivers return NUMERIC as Decimal, string or bigint depending on path */
function toAtomic(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Prisma.Decimal) return value.toFixed(0);
  throw new Error(`Cannot coerce ${typeof value} to an atomic amount`);
}

export class CodeBalanceRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** idempotent - a second call for an account that already has a balance row is a no-op. every account gets one lazily, the first time it either deposits or attempts a reservation */
  async ensureBalance(accountId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    await client.$executeRaw`
      INSERT INTO code_account_balances (account_id, balance_atomic, reserved_atomic, updated_at)
      VALUES (${accountId}, 0, 0, now())
      ON CONFLICT (account_id) DO NOTHING
    `;
  }

  /**
   * appends a ledger entry and moves the balance atomically. `txSignature`
   * makes `DEPOSIT` idempotent under `(txSignature, accountId)` - a
   * duplicate call inserts nothing and returns `false` rather than
   * double-crediting. `REFUND`/`ADJUSTMENT` have no natural idempotency
   * key, so the caller is responsible for not calling them twice.
   */
  async credit(input: { accountId: string; amountAtomic: string; type: "DEPOSIT" | "REFUND" | "ADJUSTMENT"; txSignature?: string }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await this.ensureBalance(input.accountId, tx);

      const ledgerEntryId = newId("codeLedgerEntry");
      const inserted = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO code_ledger_entries (id, account_id, type, amount_atomic, tx_signature, created_at)
        VALUES (${ledgerEntryId}, ${input.accountId}, ${input.type}::"CodeLedgerEntryType", ${input.amountAtomic}::numeric, ${input.txSignature ?? null}, now())
        ON CONFLICT (tx_signature, account_id) DO NOTHING
        RETURNING id
      `;
      if (inserted.length === 0) return false;

      await tx.$executeRaw`
        UPDATE code_account_balances
        SET balance_atomic = balance_atomic + ${input.amountAtomic}::numeric,
            updated_at = now()
        WHERE account_id = ${input.accountId}
      `;
      return true;
    });
  }

  /** the confirmed balance minus currently-held reservations - what a caller can actually spend right now. a plain read, not part of the atomic reserve decision itself (which re-checks this same arithmetic under a row lock inside `reserve`) */
  async getSpendableAtomic(accountId: string): Promise<string> {
    const rows = await this.prisma.$queryRaw<Array<{ spendable: unknown }>>`
      SELECT COALESCE(balance_atomic - reserved_atomic, 0) AS spendable
      FROM code_account_balances
      WHERE account_id = ${accountId}
    `;
    return rows.length > 0 ? toAtomic(rows[0]!.spendable) : "0";
  }

  /**
   * reserves `estimatedAtomic` against the account's spendable balance and
   * creates the `UsageReservation` row, atomically - either both happen or
   * neither does. a zero-row guarded `UPDATE` (insufficient balance) rolls
   * the whole transaction back rather than partially reserving.
   */
  async reserve(input: ReserveUsageInput): Promise<ReserveUsageResult> {
    return this.prisma.$transaction(async (tx) => {
      await this.ensureBalance(input.accountId, tx);

      const updated = await tx.$executeRaw`
        UPDATE code_account_balances
        SET reserved_atomic = reserved_atomic + ${input.estimatedAtomic}::numeric,
            updated_at = now()
        WHERE account_id = ${input.accountId}
          AND balance_atomic - reserved_atomic - ${input.estimatedAtomic}::numeric >= 0
      `;
      if (updated === 0) return { ok: false, reason: "INSUFFICIENT_BALANCE" };

      const reservationId = newId("usageReservation");
      await tx.$executeRaw`
        INSERT INTO usage_reservations
          (id, account_id, session_id, task_id, provider, model, pricing_version, estimated_atomic, status, created_at)
        VALUES
          (${reservationId}, ${input.accountId}, ${input.sessionId}, ${input.taskId},
           ${input.provider}::"InferenceProvider", ${input.model}, ${input.pricingVersion},
           ${input.estimatedAtomic}::numeric, 'RESERVED', now())
      `;
      return { ok: true, reservationId };
    });
  }

  /**
   * commits the reservation to a `UsageEvent` and a `USAGE_CHARGE` ledger
   * entry, releasing the full estimated hold. idempotent - a reservation
   * not in `RESERVED` status is a no-op, safe for retry after an
   * indeterminate outcome.
   *
   * `actualAtomic` is capped at `estimatedAtomic` before debiting the
   * balance or ledger, since the reservation is all the account had
   * guaranteed at reserve time (see `usage-pricing.ts`'s character-based
   * estimator). `UsageEvent` still records the uncapped `actualAtomic` for
   * cost analytics - any gap is Paymod's own absorbed cost.
   */
  async commit(
    reservationId: string,
    usage: { inputTokens: number; cachedInputTokens?: number; outputTokens: number; providerCostAtomic: string; markupAtomic: string; actualAtomic: string; providerRequestId?: string },
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const reservations = await tx.$queryRaw<Array<{ id: string; account_id: string; session_id: string; task_id: string; provider: string; model: string; pricing_version: number; estimated_atomic: unknown }>>`
        SELECT id, account_id, session_id, task_id, provider, model, pricing_version, estimated_atomic
        FROM usage_reservations
        WHERE id = ${reservationId} AND status = 'RESERVED'
        FOR UPDATE
      `;
      const reservation = reservations[0];
      if (!reservation) return false;

      const charged = await tx.$queryRaw<Array<{ charged: unknown }>>`
        SELECT LEAST(${usage.actualAtomic}::numeric, ${toAtomic(reservation.estimated_atomic)}::numeric) AS charged
      `;
      const chargedAtomic = toAtomic(charged[0]!.charged);

      await tx.$executeRaw`
        UPDATE code_account_balances
        SET balance_atomic = balance_atomic - ${chargedAtomic}::numeric,
            reserved_atomic = reserved_atomic - ${toAtomic(reservation.estimated_atomic)}::numeric,
            updated_at = now()
        WHERE account_id = ${reservation.account_id}
      `;

      await tx.$executeRaw`
        UPDATE usage_reservations
        SET status = 'COMMITTED', actual_atomic = ${usage.actualAtomic}::numeric, finalized_at = now()
        WHERE id = ${reservationId} AND status = 'RESERVED'
      `;

      const usageEventId = newId("usageEvent");
      await tx.$executeRaw`
        INSERT INTO usage_events
          (id, account_id, session_id, task_id, reservation_id, provider, model,
           input_tokens, cached_input_tokens, output_tokens,
           provider_cost_atomic, markup_atomic, charged_atomic, pricing_version, provider_request_id, created_at)
        VALUES
          (${usageEventId}, ${reservation.account_id}, ${reservation.session_id}, ${reservation.task_id}, ${reservationId},
           ${reservation.provider}::"InferenceProvider", ${reservation.model},
           ${usage.inputTokens}, ${usage.cachedInputTokens ?? null}, ${usage.outputTokens},
           ${usage.providerCostAtomic}::numeric, ${usage.markupAtomic}::numeric, ${usage.actualAtomic}::numeric,
           ${reservation.pricing_version}, ${usage.providerRequestId ?? null}, now())
      `;

      const ledgerEntryId = newId("codeLedgerEntry");
      await tx.$executeRaw`
        INSERT INTO code_ledger_entries (id, account_id, type, amount_atomic, usage_event_id, created_at)
        VALUES (${ledgerEntryId}, ${reservation.account_id}, 'USAGE_CHARGE', ${"-" + chargedAtomic}::numeric, ${usageEventId}, now())
      `;

      return true;
    });
  }

  /** proven non-execution only - the request failed before the upstream provider was ever called, or the provider explicitly rejected it before generating anything. releasing an indeterminate outcome is what `markReconciliationRequired` exists to prevent */
  async release(reservationId: string, status: "RELEASED" | "EXPIRED" = "RELEASED"): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const reservations = await tx.$queryRaw<Array<{ id: string; account_id: string; estimated_atomic: unknown }>>`
        SELECT id, account_id, estimated_atomic FROM usage_reservations WHERE id = ${reservationId} AND status = 'RESERVED' FOR UPDATE
      `;
      const reservation = reservations[0];
      if (!reservation) return false;

      await tx.$executeRaw`
        UPDATE code_account_balances
        SET reserved_atomic = reserved_atomic - ${toAtomic(reservation.estimated_atomic)}::numeric,
            updated_at = now()
        WHERE account_id = ${reservation.account_id}
      `;
      await tx.$executeRaw`
        UPDATE usage_reservations
        SET status = ${status}::"UsageReservationStatus", finalized_at = now()
        WHERE id = ${reservationId} AND status = 'RESERVED'
      `;
      return true;
    });
  }

  /**
   * the provider may have generated tokens but the terminal usage event
   * never arrived (client disconnect or network failure mid-stream).
   * deliberately leaves `reserved_atomic` untouched, over-reservation
   * rather than over-payment, until a human or reconciliation job
   * resolves it.
   */
  async markReconciliationRequired(reservationId: string): Promise<boolean> {
    const updated = await this.prisma.$executeRaw`
      UPDATE usage_reservations
      SET status = 'RECONCILIATION_REQUIRED', finalized_at = now()
      WHERE id = ${reservationId} AND status = 'RESERVED'
    `;
    return updated > 0;
  }
}
