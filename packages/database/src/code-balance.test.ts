import test, { before, beforeEach, after, describe } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { newId } from "@paymod/shared";
import { CodeBalanceRepository } from "./code-balance.js";

/**
 * requires real PostgreSQL 16 (same as `reservations.test.ts`) - these
 * tests prove behavior under genuine concurrency via the guarded
 * `UPDATE`'s row lock, which an in-memory fake can't exercise.
 *
 *   docker compose up -d
 *   npm --workspace @paymod/database run test
 */

const prisma = new PrismaClient();
const repo = new CodeBalanceRepository(prisma);

let accountId: string;

async function resetDatabase() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "usage_events", "usage_reservations", "code_ledger_entries", "code_account_balances",
      "code_deposit_addresses", "code_credentials", "agent_wallets", "accounts", "users"
    RESTART IDENTITY CASCADE
  `);
}

async function seedBalance(atomic: string): Promise<void> {
  await prisma.codeAccountBalance.create({ data: { accountId, balanceAtomic: atomic, reservedAtomic: "0" } });
}

function reserveInput(estimatedAtomic: string) {
  return { accountId, sessionId: "ses_test", taskId: newId("request"), provider: "OPENAI" as const, model: "gpt-4o", pricingVersion: 1, estimatedAtomic };
}

before(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  await resetDatabase();
  const userId = newId("user");
  accountId = newId("account");
  await prisma.user.create({ data: { id: userId, email: `${userId}@test.paymod.dev`, passwordHash: "x", name: "Test" } });
  await prisma.account.create({ data: { id: accountId, userId, name: "Test" } });
});

after(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

describe("The headline proof", () => {
  test("20 concurrent reservations against a balance of 10 overspend zero times", async () => {
    await seedBalance("10");

    const results = await Promise.all(Array.from({ length: 20 }, () => repo.reserve(reserveInput("1"))));

    const granted = results.filter((r) => r.ok).length;
    const refused = results.filter((r) => !r.ok).length;
    assert.equal(granted, 10, "exactly the balance should be granted");
    assert.equal(refused, 10, "the rest must be cleanly refused, not overspend");

    const balance = await prisma.codeAccountBalance.findUniqueOrThrow({ where: { accountId } });
    assert.equal(balance.reservedAtomic.toFixed(0), "10");
    assert.equal(balance.balanceAtomic.toFixed(0), "10", "balance itself is untouched until commit");

    const reserved = await prisma.usageReservation.count({ where: { status: "RESERVED" } });
    assert.equal(reserved, 10);
  });
});

describe("credit", () => {
  test("a deposit raises the balance and is not held as reserved", async () => {
    const credited = await repo.credit({ accountId, amountAtomic: "500", type: "DEPOSIT", txSignature: "sig1" });
    assert.equal(credited, true);

    const balance = await prisma.codeAccountBalance.findUniqueOrThrow({ where: { accountId } });
    assert.equal(balance.balanceAtomic.toFixed(0), "500");
    assert.equal(balance.reservedAtomic.toFixed(0), "0");

    const entry = await prisma.codeLedgerEntry.findFirstOrThrow({ where: { accountId, type: "DEPOSIT" } });
    assert.equal(entry.amountAtomic.toFixed(0), "500");
    assert.equal(entry.txSignature, "sig1");
  });

  test("crediting the same tx signature twice is a no-op, not a double credit", async () => {
    assert.equal(await repo.credit({ accountId, amountAtomic: "500", type: "DEPOSIT", txSignature: "sig1" }), true);
    assert.equal(await repo.credit({ accountId, amountAtomic: "500", type: "DEPOSIT", txSignature: "sig1" }), false);

    const balance = await prisma.codeAccountBalance.findUniqueOrThrow({ where: { accountId } });
    assert.equal(balance.balanceAtomic.toFixed(0), "500", "the second call must not add another 500");
  });

  test("20 concurrent deposits with distinct signatures all credit exactly once each", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => repo.credit({ accountId, amountAtomic: "1", type: "DEPOSIT", txSignature: `sig_${i}` })),
    );
    assert.equal(results.filter(Boolean).length, 20);

    const balance = await prisma.codeAccountBalance.findUniqueOrThrow({ where: { accountId } });
    assert.equal(balance.balanceAtomic.toFixed(0), "20");
  });
});

describe("reserve", () => {
  test("insufficient balance is refused without creating a reservation row", async () => {
    await seedBalance("5");
    const result = await repo.reserve(reserveInput("10"));
    assert.deepEqual(result, { ok: false, reason: "INSUFFICIENT_BALANCE" });
    assert.equal(await prisma.usageReservation.count(), 0);
    const balance = await prisma.codeAccountBalance.findUniqueOrThrow({ where: { accountId } });
    assert.equal(balance.reservedAtomic.toFixed(0), "0");
  });

  test("an account with no balance row yet is lazily given a zero balance and refused, not errored", async () => {
    const result = await repo.reserve(reserveInput("1"));
    assert.deepEqual(result, { ok: false, reason: "INSUFFICIENT_BALANCE" });
  });
});

describe("commit", () => {
  test("only the actual charge reduces the balance - the unused estimate is released, not spent", async () => {
    await seedBalance("100");
    const reserved = await repo.reserve(reserveInput("40"));
    assert.ok(reserved.ok);

    const committed = await repo.commit(reserved.reservationId, {
      inputTokens: 100,
      outputTokens: 50,
      providerCostAtomic: "15",
      markupAtomic: "2",
      actualAtomic: "17",
    });
    assert.equal(committed, true);

    const balance = await prisma.codeAccountBalance.findUniqueOrThrow({ where: { accountId } });
    assert.equal(balance.balanceAtomic.toFixed(0), "83", "100 - 17 actual, not 100 - 40 estimated");
    assert.equal(balance.reservedAtomic.toFixed(0), "0", "the full estimate is released once committed");

    const event = await prisma.usageEvent.findFirstOrThrow({ where: { reservationId: reserved.reservationId } });
    assert.equal(event.chargedAtomic.toFixed(0), "17");

    const ledgerEntry = await prisma.codeLedgerEntry.findFirstOrThrow({ where: { usageEventId: event.id } });
    assert.equal(ledgerEntry.type, "USAGE_CHARGE");
    assert.equal(ledgerEntry.amountAtomic.toFixed(0), "-17");
  });

  test("an actual charge above the estimate is capped at the estimate - the balance is never debited more than what was reserved", async () => {
    await seedBalance("100");
    const reserved = await repo.reserve(reserveInput("40"));
    assert.ok(reserved.ok);

    await repo.commit(reserved.reservationId, {
      inputTokens: 100,
      outputTokens: 50,
      providerCostAtomic: "55",
      markupAtomic: "5",
      actualAtomic: "60", // above the 40 reserved
    });

    const balance = await prisma.codeAccountBalance.findUniqueOrThrow({ where: { accountId } });
    assert.equal(balance.balanceAtomic.toFixed(0), "60", "debited exactly 40 (the reservation), not the full 60 reported");

    const event = await prisma.usageEvent.findFirstOrThrow({ where: { reservationId: reserved.reservationId } });
    assert.equal(event.chargedAtomic.toFixed(0), "60", "the audit record still shows the true, uncapped cost");

    const ledgerEntry = await prisma.codeLedgerEntry.findFirstOrThrow({ where: { usageEventId: event.id } });
    assert.equal(ledgerEntry.amountAtomic.toFixed(0), "-40", "what was actually collected is capped at the reservation");
  });

  test("committing an already-committed reservation is a no-op, safe for a retry", async () => {
    await seedBalance("100");
    const reserved = await repo.reserve(reserveInput("40"));
    assert.ok(reserved.ok);
    const usage = { inputTokens: 1, outputTokens: 1, providerCostAtomic: "10", markupAtomic: "1", actualAtomic: "11" };

    assert.equal(await repo.commit(reserved.reservationId, usage), true);
    assert.equal(await repo.commit(reserved.reservationId, usage), false, "a second commit must not double-charge");

    const balance = await prisma.codeAccountBalance.findUniqueOrThrow({ where: { accountId } });
    assert.equal(balance.balanceAtomic.toFixed(0), "89", "charged exactly once");
  });
});

describe("release", () => {
  test("a released reservation frees the hold without touching the balance", async () => {
    await seedBalance("100");
    const reserved = await repo.reserve(reserveInput("40"));
    assert.ok(reserved.ok);

    assert.equal(await repo.release(reserved.reservationId), true);

    const balance = await prisma.codeAccountBalance.findUniqueOrThrow({ where: { accountId } });
    assert.equal(balance.balanceAtomic.toFixed(0), "100");
    assert.equal(balance.reservedAtomic.toFixed(0), "0");

    const reservation = await prisma.usageReservation.findUniqueOrThrow({ where: { id: reserved.reservationId } });
    assert.equal(reservation.status, "RELEASED");
  });
});

describe("markReconciliationRequired", () => {
  test("the hold stays in place - over-reservation, never silently refunded", async () => {
    await seedBalance("100");
    const reserved = await repo.reserve(reserveInput("40"));
    assert.ok(reserved.ok);

    assert.equal(await repo.markReconciliationRequired(reserved.reservationId), true);

    const balance = await prisma.codeAccountBalance.findUniqueOrThrow({ where: { accountId } });
    assert.equal(balance.reservedAtomic.toFixed(0), "40", "the hold is preserved, not released");

    const reservation = await prisma.usageReservation.findUniqueOrThrow({ where: { id: reserved.reservationId } });
    assert.equal(reservation.status, "RECONCILIATION_REQUIRED");

    // spendable correctly reflects the held reservation, even though it's
    // in an indeterminate state - the money isn't free to reserve again.
    assert.equal(await repo.getSpendableAtomic(accountId), "60");
  });
});
