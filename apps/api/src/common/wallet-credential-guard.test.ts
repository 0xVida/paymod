import test, { before, beforeEach, after, describe } from "node:test";
import assert from "node:assert/strict";
import type { ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import { newId } from "@paymod/shared";
import { PrismaService } from "./prisma.service.js";
import { WalletCredentialGuard } from "./wallet-credential.guard.js";
import { generateCredential } from "./credentials.js";

/**
 * `WalletCredentialGuard` is the wallet half of ADR 0010's wallet-binding
 * invariant: a credential authenticates as exactly the wallet it was
 * issued for, derived from the `WalletCredential -> AgentWallet` relation
 * alone. The financial write endpoints don't accept a walletId in their
 * body at all, so cross-wallet credential use has no code path to attempt.
 * These tests exercise that binding against a real Postgres session.
 *
 *   docker compose up -d
 *   npm --workspace @paymod/api run test
 */

const prisma = new PrismaService();

let accountId: string;
let walletAId: string;
let walletBId: string;
let secretA: string;
let secretB: string;

function fakeContext(authorization: string | undefined): ExecutionContext {
  const req: Partial<Request> = { headers: authorization ? { authorization } : {} };
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

before(async () => {
  await prisma.$connect();
});

async function resetDatabase() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "sessions", "users",
      "chain_tx_attempts", "settlements", "spend_reservations", "budget_periods",
      "financial_intents", "wallet_assets", "wallet_credentials", "code_credentials",
      "policies", "agent_wallets", "audit_events", "idempotency_records", "accounts"
    RESTART IDENTITY CASCADE
  `);
}

beforeEach(async () => {
  await resetDatabase();

  const userId = newId("user");
  accountId = newId("account");
  await prisma.user.create({ data: { id: userId, email: `${userId}@test.paymod.dev`, passwordHash: "x", name: "Test" } });
  await prisma.account.create({ data: { id: accountId, userId, name: "Test" } });

  walletAId = newId("wallet");
  walletBId = newId("wallet");
  await prisma.agentWallet.create({ data: { id: walletAId, accountId, name: "Wallet A" } });
  await prisma.agentWallet.create({ data: { id: walletBId, accountId, name: "Wallet B" } });

  const credA = generateCredential();
  const credB = generateCredential();
  secretA = credA.secret;
  secretB = credB.secret;
  await prisma.walletCredential.create({ data: { id: newId("credential"), walletId: walletAId, prefix: credA.prefix, hash: credA.hash } });
  await prisma.walletCredential.create({ data: { id: newId("credential"), walletId: walletBId, prefix: credB.prefix, hash: credB.hash } });
});

after(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

describe("WalletCredentialGuard", () => {
  const guard = new WalletCredentialGuard(prisma);

  test("a wallet's own credential authenticates as that wallet, never another one in the same account", async () => {
    const ctx = fakeContext(`Bearer ${secretA}`);
    const req = ctx.switchToHttp().getRequest<Request>();
    assert.equal(await guard.canActivate(ctx), true);
    assert.equal(req.paymod!.wallet.id, walletAId);
    assert.notEqual(req.paymod!.wallet.id, walletBId);
  });

  test("two different wallets' credentials resolve to their own distinct wallets, never swapped", async () => {
    const ctxA = fakeContext(`Bearer ${secretA}`);
    await guard.canActivate(ctxA);
    assert.equal(ctxA.switchToHttp().getRequest<Request>().paymod!.wallet.id, walletAId);

    const ctxB = fakeContext(`Bearer ${secretB}`);
    await guard.canActivate(ctxB);
    assert.equal(ctxB.switchToHttp().getRequest<Request>().paymod!.wallet.id, walletBId);
  });

  test("no authorization header is rejected", async () => {
    await assert.rejects(() => guard.canActivate(fakeContext(undefined)), /Missing or malformed credential/);
  });

  test("a non-pm_live_ token is rejected before any database lookup", async () => {
    await assert.rejects(() => guard.canActivate(fakeContext("Bearer sometoken")), /Missing or malformed credential/);
  });

  test("a well-formed but unknown credential is rejected", async () => {
    await assert.rejects(() => guard.canActivate(fakeContext(`Bearer pm_live_${"0".repeat(48)}`)), /Invalid credential/);
  });

  test("a revoked credential is rejected even with the correct secret", async () => {
    await prisma.walletCredential.updateMany({ where: { walletId: walletAId }, data: { revokedAt: new Date() } });
    await assert.rejects(() => guard.canActivate(fakeContext(`Bearer ${secretA}`)), /Invalid credential/);
  });

  test("a tampered secret with a matching prefix is rejected", async () => {
    const tampered = secretA.slice(0, -2) + "00";
    await assert.rejects(() => guard.canActivate(fakeContext(`Bearer ${tampered}`)), /Invalid credential/);
  });
});
