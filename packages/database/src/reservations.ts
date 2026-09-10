import { Prisma, type PrismaClient } from "@prisma/client";
import { ERROR_CODES, PaymodError, newId, parseAtomicAmount } from "@paymod/shared";

/**
 * atomic budget reservations.
 *
 * this file is the ONLY place `budget_periods` and `spend_reservations`
 * are mutated. both tables are declared in `schema.prisma` for relations
 * and `include`, but the Prisma model API must never write to them - the
 * guarantees live in CHECK constraints and guarded conditional UPDATEs
 * that `prisma.budgetPeriod.update()` would bypass.
 *
 *   reserved -> spent    only on confirmed success (commit)
 *   reserved -> released only on proven non-execution (release)
 *   anything unknown     stays reserved
 *
 * over-reservation (briefly under-budgeted until reconciled) is the only
 * acceptable failure mode here, never over-payment.
 */

export type BudgetWindowKind = "DAY" | "MONTH";

export type WindowSpec = {
  window: BudgetWindowKind;
  assetCode: string;
  networkId: string;
  startsAt: Date;
  endsAt: Date;
  /** comes from the resolved policy rule, which is the single source of truth */
  limitAtomic: string;
  /**
   * which budget this window draws down - a specific wallet's or `null` for
   * the shared account-wide pool. distinct from `ReserveInput.walletId`, which
   * always names the wallet that made the request - a wallet drawing on an
   * account-wide budget is the normal case, not an edge case.
   */
  scopeWalletId: string | null;
};

export type ReserveInput = {
  accountId: string;
  /** the wallet that made the request, always present */
  walletId: string;
  intentId: string;
  requestId: string;
  idempotencyKey: string;
  amountAtomic: string;
  expiresAt: Date;
  windows: WindowSpec[];
};

export type ReservationRow = {
  id: string;
  budgetPeriodId: string;
  window: BudgetWindowKind;
  requestedAtomic: string;
};

/**
 * every transaction touches its budget rows in this order. a consistent global
 * ordering is what prevents deadlock when two concurrent intents contend for
 * the same DAY and MONTH rows. reverse the order in one caller and you get
 * intermittent, load-dependent deadlocks that are miserable to reproduce.
 */
const WINDOW_RANK: Record<BudgetWindowKind, number> = { DAY: 0, MONTH: 1 };

function orderWindows<T extends { window: BudgetWindowKind }>(windows: T[]): T[] {
  return [...windows].sort((a, b) => WINDOW_RANK[a.window] - WINDOW_RANK[b.window]);
}

/** raw drivers return NUMERIC as Decimal, string or number depending on path */
function toAtomic(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Prisma.Decimal) return value.toFixed(0);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`Refusing to coerce unsafe number ${value} to an atomic amount`);
    }
    return value.toString();
  }
  if (value === null || value === undefined) throw new Error("Expected an atomic amount, got null");
  return String(value);
}

export class ReservationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * reserves `amountAtomic` against every supplied window, atomically. a
   * zero-row result from the guarded UPDATE means the budget would be
   * exceeded (expected, not an error) and rolls back the whole
   * transaction. idempotent on `(budgetPeriodId, idempotencyKey)`.
   *
   * pass `tx` to run inside a transaction the caller already owns (Prisma
   * has no nested-transaction primitive, so this runs directly against
   * `tx` rather than opening a second one). omit `tx` for standalone calls.
   */
  async reserve(input: ReserveInput, tx?: Prisma.TransactionClient): Promise<ReservationRow[]> {
    const amount = parseAtomicAmount(input.amountAtomic);
    if (amount <= 0n) {
      throw new PaymodError(ERROR_CODES.VALIDATION_FAILED, "Reservation amount must be positive.", {
        requestId: input.requestId,
      });
    }

    if (tx) return this.reserveWithin(tx, input);
    return this.prisma.$transaction((inner) => this.reserveWithin(inner, input));
  }

  private async reserveWithin(tx: Prisma.TransactionClient, input: ReserveInput): Promise<ReservationRow[]> {
    const rows: ReservationRow[] = [];
    for (const spec of orderWindows(input.windows)) {
      rows.push(await this.reserveOneWindow(tx, input, spec));
    }
    return rows;
  }

  /** reserves `input.amountAtomic` against a single window or replays an existing hold for the same key */
  private async reserveOneWindow(
    tx: Prisma.TransactionClient,
    input: ReserveInput,
    spec: WindowSpec,
  ): Promise<ReservationRow> {
    const periodId = await this.ensurePeriod(tx, input, spec);

    // replay guard, checked inside the transaction so two concurrent
    // replays of the same key can't both proceed to the UPDATE
    const existing = await tx.$queryRaw<Array<{ id: string; requested_atomic: unknown }>>`
      SELECT "id", "requested_atomic" FROM "spend_reservations"
      WHERE "budget_period_id" = ${periodId} AND "idempotency_key" = ${input.idempotencyKey}
    `;
    if (existing.length > 0) {
      return {
        id: existing[0]!.id,
        budgetPeriodId: periodId,
        window: spec.window,
        requestedAtomic: toAtomic(existing[0]!.requested_atomic),
      };
    }

    // the guarded conditional UPDATE - this (not the policy engine) is the
    // authoritative, race-proof budget check. the predicate re-reads
    // spent+reserved under the row lock, so concurrent reservations
    // serialize here rather than both seeing stale headroom.
    const updated = await tx.$executeRaw`
      UPDATE "budget_periods"
      SET "reserved_atomic" = "reserved_atomic" + ${input.amountAtomic}::numeric
      WHERE "id" = ${periodId}
        AND now() >= "starts_at"
        AND now() < "ends_at"
        AND "spent_atomic" + "reserved_atomic" + ${input.amountAtomic}::numeric <= "limit_atomic"
    `;
    if (updated === 0) {
      throw new PaymodError(
        spec.window === "DAY" ? ERROR_CODES.DAILY_LIMIT_EXCEEDED : ERROR_CODES.MONTHLY_LIMIT_EXCEEDED,
        `Reservation would exceed the ${spec.window.toLowerCase()} budget.`,
        { requestId: input.requestId, details: { window: spec.window } },
      );
    }

    const reservationId = newId("reservation");
    await tx.$executeRaw`
      INSERT INTO "spend_reservations"
        ("id", "budget_period_id", "intent_id", "wallet_id", "request_id",
         "idempotency_key", "requested_atomic", "status", "expires_at", "created_at")
      VALUES
        (${reservationId}, ${periodId}, ${input.intentId}, ${input.walletId},
         ${input.requestId}, ${input.idempotencyKey}, ${input.amountAtomic}::numeric,
         'RESERVED', ${input.expiresAt}, now())
    `;
    return { id: reservationId, budgetPeriodId: periodId, window: spec.window, requestedAtomic: input.amountAtomic };
  }

  /**
   * confirmed success - release the hold and record the actual spend.
   *
   * `actualAtomic` may be under the reservation but never over it - the CHECK
   * constraint enforces that. an overage must become a new, separately
   * governed intent rather than silently overspending the budget.
   *
   * idempotent - committing an already-committed intent is a no-op, which is
   * what makes worker retries safe. see `reserve`'s docblock for when to pass
   * `tx`.
   */
  async commit(intentId: string, actualAtomic: string, tx?: Prisma.TransactionClient): Promise<number> {
    if (tx) return this.commitWithin(tx, intentId, actualAtomic);
    return this.prisma.$transaction((inner) => this.commitWithin(inner, intentId, actualAtomic));
  }

  private async commitWithin(
    tx: Prisma.TransactionClient,
    intentId: string,
    actualAtomic: string,
  ): Promise<number> {
    const open = await tx.$queryRaw<Array<{ id: string; budget_period_id: string; requested_atomic: unknown; window: BudgetWindowKind }>>`
      SELECT r."id", r."budget_period_id", r."requested_atomic", p."window"
      FROM "spend_reservations" r
      JOIN "budget_periods" p ON p."id" = r."budget_period_id"
      WHERE r."intent_id" = ${intentId} AND r."status" = 'RESERVED'
      ORDER BY (CASE p."window" WHEN 'DAY' THEN 0 ELSE 1 END)
      FOR UPDATE OF r
    `;

    // already settled by a previous attempt, not an error - this is exactly
    // what a retry after an indeterminate outcome looks like
    if (open.length === 0) return 0;

    for (const row of orderWindows(open.map((r) => ({ ...r, window: r.window })))) {
      await tx.$executeRaw`
        UPDATE "budget_periods"
        SET "reserved_atomic" = "reserved_atomic" - ${toAtomic(row.requested_atomic)}::numeric,
            "spent_atomic"    = "spent_atomic"    + ${actualAtomic}::numeric
        WHERE "id" = ${row.budget_period_id}
      `;
      await tx.$executeRaw`
        UPDATE "spend_reservations"
        SET "status" = 'COMMITTED', "actual_atomic" = ${actualAtomic}::numeric, "finalized_at" = now()
        WHERE "id" = ${row.id} AND "status" = 'RESERVED'
      `;
    }

    return open.length;
  }

  /**
   * proven non-execution only.
   *
   * never call this on an indeterminate settlement. if you can't prove the
   * payment didn't land, the reservation must stay held and the reconciler
   * resolves it by re-submitting the deterministic payment id. see
   * `reserve`'s docblock for when to pass `tx`.
   */
  async release(
    intentId: string,
    status: "RELEASED" | "EXPIRED" = "RELEASED",
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    if (tx) return this.releaseWithin(tx, intentId, status);
    return this.prisma.$transaction((inner) => this.releaseWithin(inner, intentId, status));
  }

  private async releaseWithin(
    tx: Prisma.TransactionClient,
    intentId: string,
    status: "RELEASED" | "EXPIRED",
  ): Promise<number> {
    const open = await tx.$queryRaw<Array<{ id: string; budget_period_id: string; requested_atomic: unknown; window: BudgetWindowKind }>>`
      SELECT r."id", r."budget_period_id", r."requested_atomic", p."window"
      FROM "spend_reservations" r
      JOIN "budget_periods" p ON p."id" = r."budget_period_id"
      WHERE r."intent_id" = ${intentId} AND r."status" = 'RESERVED'
      ORDER BY (CASE p."window" WHEN 'DAY' THEN 0 ELSE 1 END)
      FOR UPDATE OF r
    `;
    if (open.length === 0) return 0;

    for (const row of open) {
      await tx.$executeRaw`
        UPDATE "budget_periods"
        SET "reserved_atomic" = "reserved_atomic" - ${toAtomic(row.requested_atomic)}::numeric
        WHERE "id" = ${row.budget_period_id}
      `;
      await tx.$executeRaw`
        UPDATE "spend_reservations"
        SET "status" = ${status}::"ReservationStatus",
            "actual_atomic" = 0,
            "finalized_at" = now()
        WHERE "id" = ${row.id} AND "status" = 'RESERVED'
      `;
    }
    return open.length;
  }

  /**
   * expiry sweeper. the `NOT EXISTS` guard is the most important clause in
   * this file - a reservation whose intent is mid-flight on chain
   * (PROCESSING with a submitted or unresolved attempt) must never be
   * swept, however long it has been open - releasing it would let a
   * second payment reserve the same headroom while the first is still in
   * the air, which is how a double-spend gets built. those go to the
   * reconciler instead
   */
  async expireDue(limit = 100): Promise<string[]> {
    const due = await this.prisma.$queryRaw<Array<{ intent_id: string }>>`
      SELECT DISTINCT r."intent_id"
      FROM "spend_reservations" r
      JOIN "financial_intents" i ON i."id" = r."intent_id"
      WHERE r."status" = 'RESERVED'
        AND r."expires_at" < now()
        AND NOT EXISTS (
          SELECT 1 FROM "settlements" s
          JOIN "chain_tx_attempts" a ON a."settlement_id" = s."id"
          WHERE s."intent_id" = i."id"
            AND a."status" IN ('SUBMITTED', 'UNKNOWN')
        )
        AND i."status" <> 'PROCESSING'
      LIMIT ${limit}
    `;

    const expired: string[] = [];
    for (const row of due) {
      if ((await this.release(row.intent_id, "EXPIRED")) > 0) expired.push(row.intent_id);
    }
    return expired;
  }

  /**
   * Observed spend per window, shaped for the policy engine's `budgets`
   * input. Pass `tx` to read within a caller-owned transaction: see
   * `reserve`'s docblock.
   */
  async readBudgets(
    accountId: string,
    walletId: string | null,
    windows: Array<Pick<WindowSpec, "window" | "assetCode" | "networkId" | "startsAt" | "endsAt">>,
    tx?: Prisma.TransactionClient,
  ): Promise<Array<{ window: BudgetWindowKind; spentAtomic: string; reservedAtomic: string }>> {
    const client = tx ?? this.prisma;
    const out = [];
    for (const spec of windows) {
      const rows = await client.$queryRaw<Array<{ spent_atomic: unknown; reserved_atomic: unknown }>>`
        SELECT "spent_atomic", "reserved_atomic" FROM "budget_periods"
        WHERE "account_id" = ${accountId}
          AND "wallet_id" IS NOT DISTINCT FROM ${walletId}
          AND "window" = ${spec.window}::"BudgetWindow"
          AND "asset_code" = ${spec.assetCode}
          AND "network_id" = ${spec.networkId}
          AND "starts_at" = ${spec.startsAt}
          AND "ends_at" = ${spec.endsAt}
      `;
      if (rows.length === 0) continue;
      out.push({
        window: spec.window,
        spentAtomic: toAtomic(rows[0]!.spent_atomic),
        reservedAtomic: toAtomic(rows[0]!.reserved_atomic),
      });
    }
    return out;
  }

  private async ensurePeriod(
    tx: Prisma.TransactionClient,
    input: ReserveInput,
    spec: WindowSpec,
  ): Promise<string> {
    const id = newId("budgetPeriod");
    // ON CONFLICT DO NOTHING keeps concurrent first-writers from racing; the
    // follow-up SELECT resolves whichever row actually won.
    await tx.$executeRaw`
      INSERT INTO "budget_periods"
        ("id", "account_id", "wallet_id", "window", "asset_code", "network_id",
         "starts_at", "ends_at", "limit_atomic", "spent_atomic", "reserved_atomic")
      VALUES
        (${id}, ${input.accountId}, ${spec.scopeWalletId}, ${spec.window}::"BudgetWindow",
         ${spec.assetCode}, ${spec.networkId}, ${spec.startsAt}, ${spec.endsAt},
         ${spec.limitAtomic}::numeric, 0, 0)
      ON CONFLICT DO NOTHING
    `;

    const found = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "budget_periods"
      WHERE "account_id" = ${input.accountId}
        AND "wallet_id" IS NOT DISTINCT FROM ${spec.scopeWalletId}
        AND "window" = ${spec.window}::"BudgetWindow"
        AND "asset_code" = ${spec.assetCode}
        AND "network_id" = ${spec.networkId}
        AND "starts_at" = ${spec.startsAt}
        AND "ends_at" = ${spec.endsAt}
    `;
    if (found.length === 0) {
      throw new PaymodError(ERROR_CODES.INTERNAL_ERROR, "Budget period could not be resolved.", {
        requestId: input.requestId,
      });
    }
    return found[0]!.id;
  }
}
