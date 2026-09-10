import test, { before, beforeEach, after, describe } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { newId } from "@paymod/shared";

/**
 * regression cover for the settlement path's intent-type boundary.
 * `SettlementService` settles through the treasury contract's
 * `execute_payment` - correct for TRANSFER, wrong for X402_PAYMENT, which
 * settles synchronously against an x402 facilitator instead. Paying its
 * merchant through `execute_payment` would move money with no x402
 * handshake and deliver nothing in exchange.
 *
 * Nothing here is caught by the type system (the sweeper selects by status
 * out of raw SQL), so it's asserted against a real database instead.
 *
 *   docker compose up -d
 *   npm --workspace @paymod/api run test
 */

const prisma = new PrismaClient();
const STUCK_LEASE_MS = 2 * 60 * 1000;
const CLAIM_LEASE_SECONDS = 120;

let accountId: string;
let walletId: string;

type IntentSeed = {
  type: "TRANSFER" | "X402_PAYMENT";
  status: "AUTHORIZED" | "PROCESSING";
  lockedAt?: Date;
};

async function makeIntent(seed: IntentSeed): Promise<string> {
  const id = newId("intent");
  await prisma.financialIntent.create({
    data: {
      id,
      accountId,
      walletId,
      requestId: newId("request"),
      idempotencyKey: id,
      type: seed.type,
      status: seed.status,
      atomicAmount: "1000",
      assetCode: "USDC",
      networkId: "stellar:testnet",
      destination: "GDEST",
      ...(seed.lockedAt !== undefined && { lockedAt: seed.lockedAt }),
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  return id;
}

/** the exact pair of queries `SettlementSweeper.retryStuckIntents` runs. */
async function sweepForRetry(): Promise<string[]> {
  const missedEnqueue = await prisma.financialIntent.findMany({
    where: { type: "TRANSFER", status: "AUTHORIZED", settlement: null },
    select: { id: true },
  });
  const staleLease = await prisma.financialIntent.findMany({
    where: { type: "TRANSFER", status: "PROCESSING", lockedAt: { lt: new Date(Date.now() - STUCK_LEASE_MS) } },
    select: { id: true },
  });
  return [...missedEnqueue, ...staleLease].map((i) => i.id);
}

/** the exact guarded UPDATE `SettlementService.claim` runs. */
async function claim(intentId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "financial_intents"
    SET "status" = 'PROCESSING', "locked_at" = now(), "attempts" = "attempts" + 1
    WHERE "id" = ${intentId}
      AND "type" = 'TRANSFER'::"IntentType"
      AND "status" IN ('AUTHORIZED', 'PROCESSING')
      AND ("locked_at" IS NULL OR "locked_at" < now() - make_interval(secs => ${CLAIM_LEASE_SECONDS}))
    RETURNING "id"
  `;
  return rows.length > 0;
}

before(async () => {
  await prisma.$connect();
});

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
  await prisma.agentWallet.create({ data: { id: walletId, accountId, name: "Agent" } });
});

after(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

describe("The sweeper never retries a non-transfer intent", () => {
  test("an x402 payment mid-flight is not swept into the transfer settlement path", async () => {
    // exactly the state X402Service.fetch leaves an intent in between
    // authorizing it and the facilitator confirming: authorized, no
    // settlement row yet. Before the type filter, the sweeper claimed this
    // and paid the merchant through execute_payment instead.
    const x402 = await makeIntent({ type: "X402_PAYMENT", status: "AUTHORIZED" });

    assert.deepEqual(await sweepForRetry(), [], "an in-flight x402 intent must be invisible to the transfer sweeper");
    assert.equal(await claim(x402), false, "and must not be claimable by the transfer settlement path even if enqueued directly");
  });

  test("an abandoned x402 payment stays unclaimable rather than being retried as a transfer", async () => {
    const x402 = await makeIntent({
      type: "X402_PAYMENT",
      status: "PROCESSING",
      lockedAt: new Date(Date.now() - 10 * 60 * 1000),
    });

    assert.deepEqual(await sweepForRetry(), [], "a stale-lease x402 intent is for the reconciler, not the transfer worker");
    assert.equal(await claim(x402), false);
  });

  test("a transfer that missed its enqueue is still swept and claimed", async () => {
    // the behaviour the type filter must not break.
    const transfer = await makeIntent({ type: "TRANSFER", status: "AUTHORIZED" });

    assert.deepEqual(await sweepForRetry(), [transfer]);
    assert.equal(await claim(transfer), true);
  });

  test("a transfer whose worker died mid-flight is still swept and reclaimed", async () => {
    const transfer = await makeIntent({
      type: "TRANSFER",
      status: "PROCESSING",
      lockedAt: new Date(Date.now() - 10 * 60 * 1000),
    });

    assert.deepEqual(await sweepForRetry(), [transfer]);
    assert.equal(await claim(transfer), true);
  });

  test("a transfer with a live lease is left alone: a second worker cannot steal it", async () => {
    const transfer = await makeIntent({ type: "TRANSFER", status: "PROCESSING", lockedAt: new Date() });

    assert.deepEqual(await sweepForRetry(), []);
    assert.equal(await claim(transfer), false);
  });

  test("the sweeper separates types under mixed load rather than taking whatever is authorized", async () => {
    const transfer = await makeIntent({ type: "TRANSFER", status: "AUTHORIZED" });
    await makeIntent({ type: "X402_PAYMENT", status: "AUTHORIZED" });
    await makeIntent({ type: "X402_PAYMENT", status: "PROCESSING", lockedAt: new Date(Date.now() - 10 * 60 * 1000) });

    assert.deepEqual(await sweepForRetry(), [transfer]);
  });
});
