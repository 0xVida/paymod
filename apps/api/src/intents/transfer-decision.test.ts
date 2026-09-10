import test, { before, beforeEach, after, describe } from "node:test";
import assert from "node:assert/strict";
import { newId } from "@paymod/shared";
import { PrismaService } from "../common/prisma.service.js";
import { IdempotencyService } from "../common/idempotency.service.js";
import { AuditService } from "../audit/audit.service.js";
import { SettlementQueue } from "../settlement/settlement.queue.js";
import { IntentsService } from "./intents.service.js";
import type { ApprovalService } from "../approvals/approval.service.js";
import type { TelegramService } from "../approvals/telegram.service.js";

/**
 * `createTransfer`'s three-valued decision (AUTHORIZED, WAITING_APPROVAL,
 * DENIED) is the boundary between "an agent's money moves" and "it
 * doesn't". `idempotency.test.ts` only exercises DENIED; this drives all
 * three through real policy rows and a real wallet against real Postgres.
 *
 * Every budget-establishing policy here is wallet-scoped:
 * `checkSpendingAuthority` (ADR 0010) never grants authority from an
 * account-wide rule alone.
 *
 *   docker compose up -d
 *   npm --workspace @paymod/api run test
 */

const prisma = new PrismaService();
const queue = new SettlementQueue();
const approvals = { createPending: async () => undefined } as unknown as ApprovalService;
const telegram = { notifyApproval: async () => undefined } as unknown as TelegramService;
const service = new IntentsService(prisma, new IdempotencyService(), new AuditService(prisma), queue, approvals, telegram);

let accountId: string;
let walletId: string;

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

async function makeActiveWallet(): Promise<void> {
  await prisma.agentWallet.update({
    where: { id: walletId },
    data: {
      networkId: "stellar:testnet",
      contractId: "CTREASURY",
      ownerAddress: "GOWNER",
      executorAddress: "GEXECUTOR",
      status: "ACTIVE",
      assets: { create: { id: newId("walletAsset"), assetCode: "USDC", decimals: 7, contractAddress: "CUSDC" } },
    },
  });
}

async function makePolicy(type: string, config: Record<string, unknown>, scopeWalletId: string | null = walletId): Promise<void> {
  await prisma.policy.create({
    data: { id: newId("policy"), accountId, walletId: scopeWalletId, type, config: config as object, priority: 0, enabled: true },
  });
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
  await queue.onModuleDestroy();
  await prisma.$disconnect();
});

describe("The transfer decision matrix", () => {
  test("AUTHORIZED: a wallet and a permissive policy let a transfer through, budget reserved", async () => {
    await makeActiveWallet();
    await makePolicy("DAILY_LIMIT", { limitAtomic: "10000000" });
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    const wallet = await prisma.agentWallet.findUniqueOrThrow({ where: { id: walletId } });

    const result = await service.createTransfer(account, wallet, newId("request"), { amount: "1000000", destination: "GDEST" });

    assert.equal(result.status, "AUTHORIZED");
    const intent = await prisma.financialIntent.findUniqueOrThrow({ where: { id: result.intentId } });
    assert.equal(intent.status, "AUTHORIZED");
    assert.equal(intent.decision, "ALLOW");

    const reservations = await prisma.spendReservation.findMany({ where: { intentId: result.intentId } });
    assert.ok(reservations.length > 0, "an authorized transfer must reserve budget");
  });

  test("WAITING_APPROVAL: over the approval threshold parks the intent, budget still reserved", async () => {
    await makeActiveWallet();
    // A DAILY_LIMIT with headroom too: `reserveWindows` comes only from
    // DAILY_LIMIT/MONTHLY_LIMIT policies, so an APPROVAL_THRESHOLD alone has
    // no budget window to hold against.
    await makePolicy("DAILY_LIMIT", { limitAtomic: "10000000" });
    await makePolicy("APPROVAL_THRESHOLD", { thresholdAtomic: "500000" });
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    const wallet = await prisma.agentWallet.findUniqueOrThrow({ where: { id: walletId } });

    const result = await service.createTransfer(account, wallet, newId("request"), { amount: "1000000", destination: "GDEST" });

    assert.equal(result.status, "WAITING_APPROVAL");
    const intent = await prisma.financialIntent.findUniqueOrThrow({ where: { id: result.intentId } });
    assert.equal(intent.status, "WAITING_APPROVAL");
    assert.equal(intent.decision, "REQUIRE_APPROVAL");

    // deliberate per `authorizeAndComplete`'s own docblock: a second request
    // must not be able to spend the money out from under a pending approval.
    const reservations = await prisma.spendReservation.findMany({ where: { intentId: result.intentId } });
    assert.ok(reservations.length > 0, "budget must stay held while parked for approval");
  });

  test("DENIED: over the daily limit is refused outright, nothing reserved", async () => {
    await makeActiveWallet();
    await makePolicy("DAILY_LIMIT", { limitAtomic: "500000" });
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    const wallet = await prisma.agentWallet.findUniqueOrThrow({ where: { id: walletId } });

    const result = await service.createTransfer(account, wallet, newId("request"), { amount: "1000000", destination: "GDEST" });

    assert.equal(result.status, "DENIED");
    assert.equal(result.reason, "DAILY_LIMIT_EXCEEDED");
    const intent = await prisma.financialIntent.findUniqueOrThrow({ where: { id: result.intentId } });
    assert.equal(intent.status, "DENIED");
    assert.equal(intent.decision, "DENY");

    const reservations = await prisma.spendReservation.findMany({ where: { intentId: result.intentId } });
    assert.equal(reservations.length, 0, "a denial must not reserve budget");
  });

  test("DENIED: an account-wide DAILY_LIMIT alone never grants a wallet spending authority", async () => {
    await makeActiveWallet();
    await makePolicy("DAILY_LIMIT", { limitAtomic: "10000000" }, null);
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    const wallet = await prisma.agentWallet.findUniqueOrThrow({ where: { id: walletId } });

    const result = await service.createTransfer(account, wallet, newId("request"), { amount: "1000000", destination: "GDEST" });

    assert.equal(result.status, "DENIED");
    assert.equal(result.reason, "NO_SPENDING_POLICY");

    const reservations = await prisma.spendReservation.findMany({ where: { intentId: result.intentId } });
    assert.equal(reservations.length, 0, "no spending authority must not reserve budget");
  });
});
