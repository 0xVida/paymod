import test, { before, beforeEach, after, describe } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { newId, isPaymodError } from "@paymod/shared";
import { ReservationRepository, type WindowSpec } from "./reservations.js";
import { resolveDayWindow, resolveMonthWindow } from "./windows.js";

/**
 * these run against a real PostgreSQL 16. The whole point is to prove
 * behaviour under genuine concurrency, which an in-memory fake can't do.
 * The guarantee lives in Postgres row locks and CHECK constraints, so testing
 * anything else would be testing the wrong thing.
 *
 *   docker compose up -d
 *   npm --workspace @paymod/database run test
 */

const prisma = new PrismaClient();
const repo = new ReservationRepository(prisma);

let accountId: string;
let walletId: string;

const day = resolveDayWindow();
const month = resolveMonthWindow();

function dayWindow(limitAtomic: string): WindowSpec {
  return { ...day, assetCode: "USDC", networkId: "stellar:testnet", limitAtomic, scopeWalletId: null };
}
function monthWindow(limitAtomic: string): WindowSpec {
  return { ...month, assetCode: "USDC", networkId: "stellar:testnet", limitAtomic, scopeWalletId: null };
}

async function makeIntent(): Promise<string> {
  const id = newId("intent");
  await prisma.financialIntent.create({
    data: {
      id,
      accountId,
      walletId,
      requestId: newId("request"),
      idempotencyKey: id,
      type: "TRANSFER",
      atomicAmount: "1",
      assetCode: "USDC",
      networkId: "stellar:testnet",
      destination: "GDEST",
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  return id;
}

before(async () => {
  await prisma.$connect();
});

/**
 * TRUNCATE rather than deleteMany, for two deliberate schema reasons:
 *
 *  - `settlements.wallet_id` is RESTRICT, so a wallet carrying settlement
 *    history can't be deleted. That is correct for a financial ledger.
 *  - `audit_events` has an append-only trigger that rejects DELETE outright.
 *
 * Both are features and in production neither matters: accounts are suspended,
 * never hard-deleted and the audit log is meant to outlive everything it
 * describes. TRUNCATE fires statement-level triggers only, so it is the right
 * tool for resetting a test database without weakening either guarantee.
 */
async function resetDatabase() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "chain_tx_attempts", "settlements", "spend_reservations", "budget_periods",
      "financial_intents", "wallet_assets", "wallet_credentials",
      "policies", "agent_wallets", "audit_events", "idempotency_records", "accounts", "users"
    RESTART IDENTITY CASCADE
  `);
}

beforeEach(async () => {
  await resetDatabase();
  const userId = newId("user");
  accountId = newId("account");
  walletId = newId("wallet");
  await prisma.user.create({ data: { id: userId, email: `${userId}@test.paymod.dev`, passwordHash: "x", name: "Test" } });
  await prisma.account.create({ data: { id: accountId, userId, name: "Test" } });
  await prisma.agentWallet.create({ data: { id: walletId, accountId, name: "Agent", status: "ACTIVE" } });
});

after(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

describe("The headline proof", () => {
  test("20 concurrent reservations against a budget of 10 overspend zero times", async () => {
    const intents = await Promise.all(Array.from({ length: 20 }, () => makeIntent()));

    const results = await Promise.allSettled(
      intents.map((intentId) =>
        repo.reserve({
          accountId,
          walletId,
          intentId,
          requestId: newId("request"),
          idempotencyKey: intentId,
          amountAtomic: "1",
          expiresAt: new Date(Date.now() + 1_800_000),
          windows: [dayWindow("10")],
        }),
      ),
    );

    const granted = results.filter((r) => r.status === "fulfilled").length;
    const refused = results.filter((r) => r.status === "rejected").length;

    assert.equal(granted, 10, "exactly the budget should be granted");
    assert.equal(refused, 10, "the rest must be cleanly refused");

    const period = await prisma.budgetPeriod.findFirstOrThrow({ where: { accountId } });
    assert.equal(period.reservedAtomic.toFixed(0), "10");
    assert.equal(period.spentAtomic.toFixed(0), "0");
    assert.ok(
      period.spentAtomic.plus(period.reservedAtomic).lte(period.limitAtomic),
      "spent + reserved must never exceed the limit",
    );

    const open = await prisma.spendReservation.count({ where: { status: "RESERVED" } });
    assert.equal(open, 10);
  });

  test("refusals are clean policy errors, not constraint violations leaking out", async () => {
    const first = await makeIntent();
    const second = await makeIntent();
    await repo.reserve({
      accountId, walletId, intentId: first, requestId: newId("request"),
      idempotencyKey: first, amountAtomic: "10",
      expiresAt: new Date(Date.now() + 1_800_000), windows: [dayWindow("10")],
    });

    await assert.rejects(
      () =>
        repo.reserve({
          accountId, walletId, intentId: second, requestId: newId("request"),
          idempotencyKey: second, amountAtomic: "1",
          expiresAt: new Date(Date.now() + 1_800_000), windows: [dayWindow("10")],
        }),
      (err: unknown) => isPaymodError(err) && err.code === "DAILY_LIMIT_EXCEEDED",
    );
  });

  test("a reservation spanning day and month is all-or-nothing", async () => {
    const intentId = await makeIntent();
    // daily has room, monthly doesn't. Neither may end up reserved.
    await assert.rejects(() =>
      repo.reserve({
        accountId, walletId, intentId, requestId: newId("request"),
        idempotencyKey: intentId, amountAtomic: "5",
        expiresAt: new Date(Date.now() + 1_800_000),
        windows: [dayWindow("100"), monthWindow("1")],
      }),
    );

    const reservations = await prisma.spendReservation.count();
    assert.equal(reservations, 0, "the day reservation must roll back with the month failure");
    const periods = await prisma.budgetPeriod.findMany({ where: { accountId } });
    for (const p of periods) assert.equal(p.reservedAtomic.toFixed(0), "0");
  });

  test("interleaved day/month contention does not deadlock", async () => {
    for (let round = 0; round < 25; round++) {
      const intents = await Promise.all(Array.from({ length: 8 }, () => makeIntent()));
      const results = await Promise.allSettled(
        intents.map((intentId) =>
          repo.reserve({
            accountId, walletId, intentId, requestId: newId("request"),
            idempotencyKey: intentId, amountAtomic: "1",
            expiresAt: new Date(Date.now() + 1_800_000),
            windows: [dayWindow("1000"), monthWindow("1000")],
          }),
        ),
      );
      for (const r of results) {
        if (r.status === "rejected") {
          const message = String((r.reason as Error)?.message ?? r.reason);
          assert.ok(!/deadlock/i.test(message), `round ${round} deadlocked: ${message}`);
        }
      }
    }
  });
});

describe("Lifecycle", () => {
  test("commit moves reserved into spent exactly once", async () => {
    const intentId = await makeIntent();
    await repo.reserve({
      accountId, walletId, intentId, requestId: newId("request"),
      idempotencyKey: intentId, amountAtomic: "5",
      expiresAt: new Date(Date.now() + 1_800_000), windows: [dayWindow("10")],
    });

    assert.equal(await repo.commit(intentId, "5"), 1);

    const period = await prisma.budgetPeriod.findFirstOrThrow({ where: { accountId } });
    assert.equal(period.spentAtomic.toFixed(0), "5");
    assert.equal(period.reservedAtomic.toFixed(0), "0");

    // A retry after an indeterminate outcome must not double-count.
    assert.equal(await repo.commit(intentId, "5"), 0);
    const after = await prisma.budgetPeriod.findFirstOrThrow({ where: { accountId } });
    assert.equal(after.spentAtomic.toFixed(0), "5");
  });

  test("committing less than reserved returns the difference to the budget", async () => {
    const intentId = await makeIntent();
    await repo.reserve({
      accountId, walletId, intentId, requestId: newId("request"),
      idempotencyKey: intentId, amountAtomic: "10",
      expiresAt: new Date(Date.now() + 1_800_000), windows: [dayWindow("10")],
    });
    await repo.commit(intentId, "3");

    const period = await prisma.budgetPeriod.findFirstOrThrow({ where: { accountId } });
    assert.equal(period.spentAtomic.toFixed(0), "3");
    assert.equal(period.reservedAtomic.toFixed(0), "0");
  });

  test("committing more than reserved is refused by the database", async () => {
    const intentId = await makeIntent();
    await repo.reserve({
      accountId, walletId, intentId, requestId: newId("request"),
      idempotencyKey: intentId, amountAtomic: "5",
      expiresAt: new Date(Date.now() + 1_800_000), windows: [dayWindow("10")],
    });
    // an overage must become a new governed intent, never a silent overspend.
    await assert.rejects(() => repo.commit(intentId, "6"));
  });

  test("release frees the hold without recording spend", async () => {
    const intentId = await makeIntent();
    await repo.reserve({
      accountId, walletId, intentId, requestId: newId("request"),
      idempotencyKey: intentId, amountAtomic: "5",
      expiresAt: new Date(Date.now() + 1_800_000), windows: [dayWindow("10")],
    });
    assert.equal(await repo.release(intentId), 1);

    const period = await prisma.budgetPeriod.findFirstOrThrow({ where: { accountId } });
    assert.equal(period.reservedAtomic.toFixed(0), "0");
    assert.equal(period.spentAtomic.toFixed(0), "0");
    assert.equal(await repo.release(intentId), 0, "release is idempotent");
  });

  test("replaying the same idempotency key does not double-reserve", async () => {
    const intentId = await makeIntent();
    const input = {
      accountId, walletId, intentId, requestId: newId("request"),
      idempotencyKey: "same-key", amountAtomic: "4",
      expiresAt: new Date(Date.now() + 1_800_000), windows: [dayWindow("10")],
    };
    const first = await repo.reserve(input);
    const second = await repo.reserve(input);

    assert.deepEqual(first.map((r) => r.id), second.map((r) => r.id));
    const period = await prisma.budgetPeriod.findFirstOrThrow({ where: { accountId } });
    assert.equal(period.reservedAtomic.toFixed(0), "4");
  });
});

describe("The sweeper guard: the easiest place to accidentally build a double-spend", () => {
  test("the sweeper expires a stale reservation", async () => {
    const intentId = await makeIntent();
    await repo.reserve({
      accountId, walletId, intentId, requestId: newId("request"),
      idempotencyKey: intentId, amountAtomic: "5",
      expiresAt: new Date(Date.now() - 1_000), windows: [dayWindow("10")],
    });

    assert.deepEqual(await repo.expireDue(), [intentId]);
    const period = await prisma.budgetPeriod.findFirstOrThrow({ where: { accountId } });
    assert.equal(period.reservedAtomic.toFixed(0), "0");
  });

  test("the sweeper NEVER expires a reservation whose payment is in flight", async () => {
    const intentId = await makeIntent();
    await repo.reserve({
      accountId, walletId, intentId, requestId: newId("request"),
      idempotencyKey: intentId, amountAtomic: "5",
      expiresAt: new Date(Date.now() - 1_000), windows: [dayWindow("10")],
    });

    // the payment has been submitted and its outcome isn't yet known. Releasing
    // this hold would let a second payment claim the same headroom while the
    // first is still in the air: the exact shape of a double-spend.
    const settlementId = newId("intent");
    await prisma.settlement.create({
      data: { id: settlementId, intentId, walletId, paymentIdHex: "deadbeef", status: "UNKNOWN" },
    });
    await prisma.chainTxAttempt.create({
      data: { id: newId("chainTx"), settlementId, attempt: 1, status: "UNKNOWN" },
    });
    await prisma.financialIntent.update({ where: { id: intentId }, data: { status: "PROCESSING" } });

    assert.deepEqual(await repo.expireDue(), [], "in-flight payments must not be swept");
    const period = await prisma.budgetPeriod.findFirstOrThrow({ where: { accountId } });
    assert.equal(period.reservedAtomic.toFixed(0), "5", "the hold must survive");
  });
});

describe("Precision", () => {
  test("atomic amounts stay exact well past Number.MAX_SAFE_INTEGER", async () => {
    const huge = "90071992547409910000000";
    const intentId = await makeIntent();
    await repo.reserve({
      accountId, walletId, intentId, requestId: newId("request"),
      idempotencyKey: intentId, amountAtomic: huge,
      expiresAt: new Date(Date.now() + 1_800_000),
      windows: [dayWindow("90071992547409910000001")],
    });

    const period = await prisma.budgetPeriod.findFirstOrThrow({ where: { accountId } });
    assert.equal(period.reservedAtomic.toFixed(0), huge);

    const budgets = await repo.readBudgets(accountId, null, [
      { window: "DAY", assetCode: "USDC", networkId: "stellar:testnet", startsAt: day.startsAt, endsAt: day.endsAt },
    ]);
    assert.equal(budgets[0]?.reservedAtomic, huge);
  });

  test("audit events cannot be updated or deleted", async () => {
    const id = newId("request");
    await prisma.auditEvent.create({
      data: { id, accountId, actorType: "SYSTEM", action: "TEST" },
    });
    await assert.rejects(
      () => prisma.auditEvent.update({ where: { id }, data: { action: "TAMPERED" } }),
      /append-only/,
    );
    await assert.rejects(() => prisma.auditEvent.delete({ where: { id } }), /append-only/);
  });
});
