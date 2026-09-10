import test, { before, beforeEach, after, describe } from "node:test";
import assert from "node:assert/strict";
import { newId } from "@paymod/shared";
import { ReservationRepository, resolveDayWindow } from "@paymod/database";
import type { Account, AgentWallet, WalletAsset } from "@paymod/database";
import type { PaymentRequirements } from "@paymod/x402";
import type { ModuleRef } from "@nestjs/core";
import { PrismaService } from "../common/prisma.service.js";
import { AuditService } from "../audit/audit.service.js";
import type { ApprovalService } from "../approvals/approval.service.js";
import { X402Service, type X402FetchResult } from "./x402.service.js";
import type { StellarX402Signer } from "./stellar-x402.provider.js";
import type { CircleX402Signer } from "./circle-x402.provider.js";

/**
 * `X402Service.applySettlementOutcome` is the three-valued fork the
 * reservation invariant depends on: commit only on proven success, release
 * only on proven failure, stay reserved on anything unparseable (see the
 * method's own docblock). Drives that fork directly against a real
 * reservation row rather than trusting the type signature.
 *
 * Reached via a cast since `applySettlementOutcome` is private and has no
 * dependency on the network calls `pay()` wraps it in, only on the
 * merchant's response under test here.
 *
 *   docker compose up -d
 *   npm --workspace @paymod/api run test
 */

const prisma = new PrismaService();
const reservations = new ReservationRepository(prisma);
// `applySettlementOutcome` only ever touches `this.reservations`/`this.prisma`
// (see the docblock above) - neither `approvals` nor `moduleRef` (which
// backs the `telegram` getter) is reachable from it, so both stay stubs.
const service = new X402Service(prisma, new AuditService(prisma), {} as StellarX402Signer, {} as CircleX402Signer, {} as ApprovalService, {} as ModuleRef);
const applySettlementOutcome = (
  service as unknown as {
    applySettlementOutcome: (ctx: unknown, paid: Response) => Promise<X402FetchResult>;
  }
).applySettlementOutcome.bind(service);

const requirement: PaymentRequirements = {
  scheme: "exact",
  network: "stellar:testnet",
  amount: "1000000",
  asset: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  payTo: "GDJUR24PJU3XIBZNA6DZT2QVQIQ6ZMMS5A2UO3JG6CPE5TFLG7KNPJ5W",
  maxTimeoutSeconds: 60,
};

let account: Account;
let wallet: AgentWallet & { assets: WalletAsset[] };

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

function settlementHeader(body: Record<string, unknown>): Headers {
  const headers = new Headers();
  headers.set("PAYMENT-RESPONSE", Buffer.from(JSON.stringify(body)).toString("base64"));
  return headers;
}

/** reserves budget for a fresh intent and returns the context `applySettlementOutcome` expects. */
async function reservedIntent() {
  const accountId = account.id;
  const intentId = newId("intent");
  const requestId = newId("request");
  await prisma.financialIntent.create({
    data: {
      id: intentId,
      accountId,
      walletId: wallet.id,
      requestId,
      idempotencyKey: intentId,
      type: "X402_PAYMENT",
      status: "PROCESSING",
      atomicAmount: requirement.amount,
      assetCode: wallet.assets[0]!.assetCode,
      networkId: wallet.networkId!,
      destination: requirement.payTo,
      lockedAt: new Date(),
      expiresAt: new Date(Date.now() + 300_000),
    },
  });
  const day = resolveDayWindow();
  await reservations.reserve({
    accountId,
    walletId: wallet.id,
    intentId,
    requestId,
    idempotencyKey: intentId,
    amountAtomic: requirement.amount,
    expiresAt: new Date(Date.now() + 300_000),
    windows: [{ window: "DAY", assetCode: wallet.assets[0]!.assetCode, networkId: wallet.networkId!, startsAt: day.startsAt, endsAt: day.endsAt, limitAtomic: "999999999999", scopeWalletId: null }],
  });
  return { account, wallet, requirement, url: "https://merchant.test/resource", requestId, intentId };
}

async function reservationStatus(intentId: string): Promise<string | undefined> {
  const rows = await prisma.$queryRaw<Array<{ status: string }>>`
    SELECT "status" FROM "spend_reservations" WHERE "intent_id" = ${intentId}
  `;
  return rows[0]?.status;
}

beforeEach(async () => {
  await resetDatabase();

  const userId = newId("user");
  const accountId = newId("account");
  await prisma.user.create({ data: { id: userId, email: `${userId}@test.paymod.dev`, passwordHash: "x", name: "Test" } });
  await prisma.account.create({ data: { id: accountId, userId, name: "Test" } });
  account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });

  const walletId = newId("wallet");
  await prisma.agentWallet.create({
    data: {
      id: walletId,
      accountId,
      name: "Agent",
      networkId: "stellar:testnet",
      contractId: "CTREASURY",
      ownerAddress: "GOWNER",
      executorAddress: "GEXECUTOR",
      status: "ACTIVE",
      assets: { create: { id: newId("walletAsset"), assetCode: "USDC", decimals: 7, contractAddress: requirement.asset } },
    },
  });
  wallet = await prisma.agentWallet.findUniqueOrThrow({ where: { id: walletId }, include: { assets: true } });
});

after(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

describe("X402Service's three-valued settlement outcome", () => {
  test("a proven success commits the reservation to spent and marks the intent COMPLETED", async () => {
    const ctx = await reservedIntent();
    const paid = new Response("<html>ok</html>", {
      status: 200,
      headers: settlementHeader({ success: true, transaction: "deadbeef", network: "stellar:testnet" }),
    });

    const result = await applySettlementOutcome(ctx, paid);

    assert.equal(result.status, "COMPLETED");
    assert.equal(await reservationStatus(ctx.intentId), "COMMITTED");
    const intent = await prisma.financialIntent.findUniqueOrThrow({ where: { id: ctx.intentId } });
    assert.equal(intent.status, "COMPLETED");
    const settlement = await prisma.settlement.findUniqueOrThrow({ where: { intentId: ctx.intentId } });
    assert.equal(settlement.status, "CONFIRMED");
    assert.equal(settlement.txHash, "deadbeef");
  });

  test("a proven failure releases the reservation and marks the intent FAILED", async () => {
    const ctx = await reservedIntent();
    const paid = new Response(null, {
      status: 402,
      headers: settlementHeader({ success: false, errorReason: "insufficient_funds", transaction: "", network: "stellar:testnet" }),
    });

    const result = await applySettlementOutcome(ctx, paid);

    assert.equal(result.status, "FAILED");
    assert.equal(await reservationStatus(ctx.intentId), "RELEASED");
    const intent = await prisma.financialIntent.findUniqueOrThrow({ where: { id: ctx.intentId } });
    assert.equal(intent.status, "FAILED");
    await assert.rejects(() => prisma.settlement.findUniqueOrThrow({ where: { intentId: ctx.intentId } }));
  });

  test("an unparseable response cannot prove non-execution, so the reservation stays held", async () => {
    const ctx = await reservedIntent();
    const paid = new Response("<html>a proxy ate the header</html>", { status: 502 });

    const result = await applySettlementOutcome(ctx, paid);

    assert.equal(result.status, "UNKNOWN");
    assert.equal(await reservationStatus(ctx.intentId), "RESERVED", "an indeterminate outcome must never release budget");
    const intent = await prisma.financialIntent.findUniqueOrThrow({ where: { id: ctx.intentId } });
    assert.equal(intent.status, "PROCESSING");
  });
});
