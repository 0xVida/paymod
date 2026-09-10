import type { Prisma } from "@paymod/database";
import { ReservationRepository, resolveDayWindow, resolveMonthWindow, type WindowSpec } from "@paymod/database";
import type { EvaluationContextInput, PolicyRule } from "@paymod/policy-engine";
import { parseAtomicAmount } from "@paymod/shared";

/** shared by every service that evaluates policy: transfers and x402 alike. */
export async function loadPolicyRules(tx: Prisma.TransactionClient, accountId: string): Promise<PolicyRule[]> {
  const policies = await tx.policy.findMany({ where: { accountId, enabled: true } });
  return policies.map((p) => ({
    id: p.id,
    type: p.type as PolicyRule["type"],
    walletId: p.walletId,
    priority: p.priority,
    enabled: p.enabled,
    config: p.config,
  }));
}

/**
 * shared by `IntentsService` and `X402Service`: drift between two copies of
 * this DAY/MONTH window resolution would let one payment rail see a
 * different budget than another.
 *
 * `evaluatePolicy`'s `budgets` input has no scope discriminator, so scope
 * resolution (per-wallet rule replaces account-wide, per
 * `@paymod/policy-engine`'s `resolveScoped`) is replicated here just to
 * know which BudgetPeriod row to reserve against. Keep in sync with
 * policy-engine's resolution semantics.
 */
export function resolveBudgetScope(
  policies: PolicyRule[],
  type: "DAILY_LIMIT" | "MONTHLY_LIMIT",
  walletId: string,
): { scopeWalletId: string | null; limitAtomic: string } | undefined {
  const candidates = policies.filter((p) => p.enabled && p.type === type);
  const scoped = candidates.filter((p) => p.walletId === walletId);
  const pool = scoped.length > 0 ? scoped : candidates.filter((p) => p.walletId === null);
  if (pool.length === 0) return undefined;
  const topPriority = Math.max(...pool.map((p) => p.priority));
  const winners = pool.filter((p) => p.priority === topPriority);
  const limits = winners.map((p) => ({
    rule: p,
    value: parseAtomicAmount((p.config as { limitAtomic: string }).limitAtomic),
  }));
  const winner = limits.reduce((min, cur) => (cur.value < min.value ? cur : min));
  return {
    scopeWalletId: winner.rule.walletId,
    limitAtomic: (winner.rule.config as { limitAtomic: string }).limitAtomic,
  };
}

export type SpendMarket = { accountId: string; walletId: string; assetCode: string; networkId: string };

/** DAY and MONTH resolve identically bar the window kind: see resolveOneWindow. */
export async function resolveBudgets(
  reservations: ReservationRepository,
  tx: Prisma.TransactionClient,
  market: SpendMarket,
  policyRules: PolicyRule[],
): Promise<{ budgetsForEngine: EvaluationContextInput["budgets"]; reserveWindows: WindowSpec[] }> {
  const budgetsForEngine: EvaluationContextInput["budgets"] = [];
  const reserveWindows: WindowSpec[] = [];

  const dayScope = resolveBudgetScope(policyRules, "DAILY_LIMIT", market.walletId);
  if (dayScope) {
    const resolved = await resolveOneWindow(reservations, tx, market, "DAY", resolveDayWindow(), dayScope);
    budgetsForEngine.push(resolved.budget);
    reserveWindows.push(resolved.window);
  }

  const monthScope = resolveBudgetScope(policyRules, "MONTHLY_LIMIT", market.walletId);
  if (monthScope) {
    const resolved = await resolveOneWindow(reservations, tx, market, "MONTH", resolveMonthWindow(), monthScope);
    budgetsForEngine.push(resolved.budget);
    reserveWindows.push(resolved.window);
  }

  return { budgetsForEngine, reserveWindows };
}

async function resolveOneWindow(
  reservations: ReservationRepository,
  tx: Prisma.TransactionClient,
  market: SpendMarket,
  kind: "DAY" | "MONTH",
  calendar: { startsAt: Date; endsAt: Date },
  scope: { scopeWalletId: string | null; limitAtomic: string },
): Promise<{ budget: NonNullable<EvaluationContextInput["budgets"]>[number]; window: WindowSpec }> {
  const [existing] = await reservations.readBudgets(
    market.accountId,
    scope.scopeWalletId,
    [{ window: kind, assetCode: market.assetCode, networkId: market.networkId, startsAt: calendar.startsAt, endsAt: calendar.endsAt }],
    tx,
  );
  return {
    budget: { window: kind, spentAtomic: existing?.spentAtomic ?? "0", reservedAtomic: existing?.reservedAtomic ?? "0" },
    window: {
      window: kind,
      assetCode: market.assetCode,
      networkId: market.networkId,
      startsAt: calendar.startsAt,
      endsAt: calendar.endsAt,
      limitAtomic: scope.limitAtomic,
      scopeWalletId: scope.scopeWalletId,
    },
  };
}
