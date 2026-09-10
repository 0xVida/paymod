import type { BudgetWindowKind } from "./reservations.js";

/**
 * Calendar window resolution, kept out of the policy engine so it stays a
 * pure function of already-resolved inputs.
 *
 * The Soroban treasury contract's period is a TUMBLING window anchored to
 * the last payment's timestamp; these are CALENDAR windows anchored to
 * UTC midnight. They intentionally don't line up, which is why
 * treasuries carry on-chain headroom (`max_per_period = daily_limit x
 * 3`) - setting the on-chain cap equal to the off-chain daily limit
 * produces a false `PeriodLimitExceeded` on a policy-legal, already
 * approved payment. See ADR 0007.
 */

export type ResolvedWindow = {
  window: BudgetWindowKind;
  startsAt: Date;
  endsAt: Date;
};

/** [00:00 UTC today, 00:00 UTC tomorrow) */
export function resolveDayWindow(now: Date = new Date()): ResolvedWindow {
  const startsAt = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
  );
  const endsAt = new Date(startsAt);
  endsAt.setUTCDate(endsAt.getUTCDate() + 1);
  return { window: "DAY", startsAt, endsAt };
}

/** [00:00 UTC on the 1st, 00:00 UTC on the 1st of next month) */
export function resolveMonthWindow(now: Date = new Date()): ResolvedWindow {
  const startsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const endsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return { window: "MONTH", startsAt, endsAt };
}
