import test, { before, beforeEach, after, describe } from "node:test";
import assert from "node:assert/strict";
import type { ModuleRef } from "@nestjs/core";
import { newId } from "@paymod/shared";
import type { PaymentRequirements } from "@paymod/x402";
import { PrismaService } from "../common/prisma.service.js";
import { AuditService } from "../audit/audit.service.js";
import { ApprovalService } from "../approvals/approval.service.js";
import type { SettlementQueue } from "../settlement/settlement.queue.js";
import { X402Service, type X402Context } from "./x402.service.js";
import type { StellarX402Signer } from "./stellar-x402.provider.js";
import type { CircleX402Signer } from "./circle-x402.provider.js";

/**
 * `X402Service`'s policy decision (DENY / REQUIRE_APPROVAL / ALLOW) is the
 * x402 twin of `transfer-decision.test.ts`. Untestable through the public
 * `fetch()` entry point: `ssrfSafeFetch` refuses every private/loopback
 * address (deliberately, so an agent can't be tricked into treating an
 * internal resource as paywalled), so there's no way to stand in a local
 * fake merchant.
 *
 * The network-dependent halves are covered elsewhere for real:
 * `buildSignedX402Transaction` against real Testnet
 * (`x402-signer.live.test.ts`) and the real facilitator
 * (`x402-facilitator.live.test.ts`). This file reaches the private
 * `authorize` directly via a cast (TypeScript's `private` has no runtime
 * effect), since the pure policy decision has no network dependency.
 *
 *   docker compose up -d
 *   npm --workspace @paymod/api run test
 */

const prisma = new PrismaService();
// `approvals.createPending` is real (a Postgres insert) since
// `authorize()`'s REQUIRE_APPROVAL path actually calls it; its unused
// `SettlementQueue` dependency stays a stub, same as `signer` below.
// `moduleRef` backs `TelegramService`, only used by `fetch()`'s caller,
// never by `authorize()` directly.
const approvals = new ApprovalService(prisma, new AuditService(prisma), {} as SettlementQueue);
const service = new X402Service(prisma, new AuditService(prisma), {} as StellarX402Signer, {} as CircleX402Signer, approvals, {} as ModuleRef);

function callAuthorize(tx: unknown, ctx: X402Context) {
  const withPrivate = service as unknown as { authorize(tx: unknown, ctx: X402Context): Promise<unknown> };
  return withPrivate.authorize(tx, ctx);
}

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

async function makePolicy(type: string, config: Record<string, unknown>): Promise<void> {
  await prisma.policy.create({
    data: { id: newId("policy"), accountId, walletId, type, config: config as object, priority: 0, enabled: true },
  });
}

const requirement: PaymentRequirements = {
  scheme: "exact",
  network: "stellar:testnet",
  amount: "1000000",
  asset: "CUSDC",
  payTo: "GMERCHANT",
  maxTimeoutSeconds: 60,
};

beforeEach(async () => {
  await resetDatabase();
  const userId = newId("user");
  accountId = newId("account");
  walletId = newId("wallet");
  await prisma.user.create({ data: { id: userId, email: `${userId}@test.paymod.dev`, passwordHash: "x", name: "Test" } });
  await prisma.account.create({ data: { id: accountId, userId, name: "Test" } });
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
      assets: { create: { id: newId("walletAsset"), assetCode: "USDC", decimals: 7, contractAddress: "CUSDC" } },
    },
  });
});

after(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

async function makeContext(): Promise<X402Context> {
  const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
  const wallet = await prisma.agentWallet.findUniqueOrThrow({ where: { id: walletId }, include: { assets: true } });
  return {
    account,
    wallet,
    requirement,
    url: "https://merchant.example/resource",
    requestId: newId("request"),
    intentId: newId("intent"),
  };
}

describe("X402Service's policy decision matrix", () => {
  test("ALLOW: a permissive DAILY_LIMIT lets the payment through, budget reserved", async () => {
    await makePolicy("DAILY_LIMIT", { limitAtomic: "10000000" });
    const ctx = await makeContext();

    const result = await prisma.$transaction((tx) => callAuthorize(tx, ctx));
    assert.deepEqual(result, { decision: "ALLOW", ctx });

    const intent = await prisma.financialIntent.findUniqueOrThrow({ where: { id: ctx.intentId } });
    assert.equal(intent.status, "AUTHORIZED");
    assert.equal(intent.type, "X402_PAYMENT");

    const reservations = await prisma.spendReservation.findMany({ where: { intentId: ctx.intentId } });
    assert.ok(reservations.length > 0);
  });

  test("REQUIRE_APPROVAL: over the approval threshold parks the intent, budget still reserved", async () => {
    await makePolicy("DAILY_LIMIT", { limitAtomic: "10000000" });
    await makePolicy("APPROVAL_THRESHOLD", { thresholdAtomic: "500000" });
    const ctx = await makeContext();

    const result = await prisma.$transaction((tx) => callAuthorize(tx, ctx));
    assert.deepEqual(result, { decision: "REQUIRE_APPROVAL", intentId: ctx.intentId, reason: "APPROVAL_REQUIRED" });

    const intent = await prisma.financialIntent.findUniqueOrThrow({ where: { id: ctx.intentId } });
    assert.equal(intent.status, "WAITING_APPROVAL");

    const reservations = await prisma.spendReservation.findMany({ where: { intentId: ctx.intentId } });
    assert.ok(reservations.length > 0, "budget must stay held while parked, same invariant as a transfer");
  });

  test("DENY: over the daily limit is refused outright, nothing reserved", async () => {
    await makePolicy("DAILY_LIMIT", { limitAtomic: "500000" });
    const ctx = await makeContext();

    const result = await prisma.$transaction((tx) => callAuthorize(tx, ctx));
    assert.deepEqual(result, { decision: "DENY", intentId: ctx.intentId, reason: "DAILY_LIMIT_EXCEEDED" });

    const intent = await prisma.financialIntent.findUniqueOrThrow({ where: { id: ctx.intentId } });
    assert.equal(intent.status, "DENIED");

    const reservations = await prisma.spendReservation.findMany({ where: { intentId: ctx.intentId } });
    assert.equal(reservations.length, 0);
  });

  test("DENY: no policy at all denies by default, a wallet is never implicitly authorized", async () => {
    // the default-deny gate (`checkSpendingAuthority` in
    // @paymod/policy-engine): a verified wallet and zero policy rows must
    // not fall through to ALLOW. A wallet needs an explicit budget before it
    // can move any money at all.
    const ctx = await makeContext();

    const result = await prisma.$transaction((tx) => callAuthorize(tx, ctx));
    assert.deepEqual(result, { decision: "DENY", intentId: ctx.intentId, reason: "NO_SPENDING_POLICY" });

    const intent = await prisma.financialIntent.findUniqueOrThrow({ where: { id: ctx.intentId } });
    assert.equal(intent.status, "DENIED");

    const reservations = await prisma.spendReservation.findMany({ where: { intentId: ctx.intentId } });
    assert.equal(reservations.length, 0);
  });
});
