import test, { before, beforeEach, after, describe } from "node:test";
import assert from "node:assert/strict";
import { isPaymodError, newId } from "@paymod/shared";
import { PrismaService } from "../common/prisma.service.js";
import { IdempotencyService } from "../common/idempotency.service.js";
import { AuditService } from "../audit/audit.service.js";
import { SettlementQueue } from "../settlement/settlement.queue.js";
import { IntentsService } from "./intents.service.js";
import type { ApprovalService } from "../approvals/approval.service.js";
import type { TelegramService } from "../approvals/telegram.service.js";

/**
 * `IntentsService.createTransfer` runs idempotency lookup and intent
 * creation in one transaction to avoid the race where two concurrent
 * identical requests both miss the lookup (see `IdempotencyService`'s
 * docblock). These tests exercise that contract from the real entry point
 * against a real Postgres instance.
 *
 * The test wallet stays in its default `CREATING` status so every transfer
 * denies on `WALLET_NOT_READY` before touching budget or settlement,
 * isolating the idempotency contract from paths covered elsewhere.
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

describe("Idempotency on the transfer request thread", () => {
  test("replaying the same key with the same body returns the identical response and creates nothing new", async () => {
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    const wallet = await prisma.agentWallet.findUniqueOrThrow({ where: { id: walletId } });
    const key = newId("request");
    const input = { amount: "1000000", destination: "GDEST" };

    const first = await service.createTransfer(account, wallet, key, input);
    const second = await service.createTransfer(account, wallet, key, input);

    assert.deepEqual(second, first);
    assert.equal(first.status, "DENIED");

    const intents = await prisma.financialIntent.findMany({ where: { accountId } });
    assert.equal(intents.length, 1, "a replay must not create a second intent");

    const denials = await prisma.auditEvent.findMany({ where: { accountId, action: "INTENT_DENIED" } });
    assert.equal(denials.length, 1, "a replay must not write a second audit event");
  });

  test("the same key with a different body is rejected as a conflict, not silently accepted", async () => {
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    const wallet = await prisma.agentWallet.findUniqueOrThrow({ where: { id: walletId } });
    const key = newId("request");

    await service.createTransfer(account, wallet, key, { amount: "1000000", destination: "GDEST" });

    await assert.rejects(
      () => service.createTransfer(account, wallet, key, { amount: "2000000", destination: "GDEST" }),
      (error: unknown) => {
        assert.ok(isPaymodError(error));
        assert.equal(error.code, "IDEMPOTENCY_CONFLICT");
        return true;
      },
    );

    const intents = await prisma.financialIntent.findMany({ where: { accountId } });
    assert.equal(intents.length, 1, "a conflicting replay must not create a second intent");
  });

  test("different keys for the same account each create their own intent", async () => {
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    const wallet = await prisma.agentWallet.findUniqueOrThrow({ where: { id: walletId } });
    const input = { amount: "1000000", destination: "GDEST" };

    const first = await service.createTransfer(account, wallet, newId("request"), input);
    const second = await service.createTransfer(account, wallet, newId("request"), input);

    assert.notEqual(first.intentId, second.intentId);
    const intents = await prisma.financialIntent.findMany({ where: { accountId } });
    assert.equal(intents.length, 2);
  });
});
