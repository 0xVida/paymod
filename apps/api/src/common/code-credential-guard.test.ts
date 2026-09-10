import test, { before, beforeEach, after, describe } from "node:test";
import assert from "node:assert/strict";
import type { ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import { newId } from "@paymod/shared";
import { PrismaService } from "./prisma.service.js";
import { CodeCredentialGuard } from "./code-credential.guard.js";
import { WalletCredentialGuard } from "./wallet-credential.guard.js";
import { generateCredential, CODE_CREDENTIAL_PREFIX } from "./credentials.js";

/**
 * `CodeCredentialGuard` authenticates the `pmcode_...` secret Paymod Code's
 * device-auth flow mints; it is a deliberately separate table/prefix from
 * `WalletCredentialGuard`'s `WalletCredential` so a coding session can never
 * authenticate a financial endpoint, and vice versa. These tests cover both
 * the guard's own credential-validity cases (mirroring
 * `wallet-credential-guard.test.ts`) and the cross-guard isolation itself.
 *
 *   docker compose up -d
 *   npm --workspace @paymod/api run test
 */

const prisma = new PrismaService();

let accountId: string;
let walletId: string;
let codeSecret: string;
let walletSecret: string;

function fakeContext(headers: Record<string, string | undefined>): ExecutionContext {
  const req: Partial<Request> = { headers };
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

  walletId = newId("wallet");
  await prisma.agentWallet.create({ data: { id: walletId, accountId, name: "Coding Agent Wallet" } });

  const codeCredential = generateCredential(CODE_CREDENTIAL_PREFIX);
  codeSecret = codeCredential.secret;
  await prisma.codeCredential.create({
    data: { id: newId("codeCredential"), accountId, walletId, prefix: codeCredential.prefix, hash: codeCredential.hash },
  });

  const walletCredential = generateCredential();
  walletSecret = walletCredential.secret;
  await prisma.walletCredential.create({
    data: { id: newId("credential"), walletId, prefix: walletCredential.prefix, hash: walletCredential.hash },
  });
});

after(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

describe("CodeCredentialGuard", () => {
  const guard = new CodeCredentialGuard(prisma);

  test("authenticates via x-api-key, the Anthropic wire format", async () => {
    const ctx = fakeContext({ "x-api-key": codeSecret });
    assert.equal(await guard.canActivate(ctx), true);
    assert.equal(ctx.switchToHttp().getRequest<Request>().paymod!.wallet.id, walletId);
  });

  test("authenticates via Authorization: Bearer, the OpenAI wire format", async () => {
    const ctx = fakeContext({ authorization: `Bearer ${codeSecret}` });
    assert.equal(await guard.canActivate(ctx), true);
    assert.equal(ctx.switchToHttp().getRequest<Request>().paymod!.wallet.id, walletId);
  });

  test("no credential on either header is rejected", async () => {
    await assert.rejects(() => guard.canActivate(fakeContext({})), /Missing or malformed credential/);
  });

  test("a well-formed but unknown credential is rejected", async () => {
    await assert.rejects(() => guard.canActivate(fakeContext({ "x-api-key": `${CODE_CREDENTIAL_PREFIX}${"0".repeat(48)}` })), /Invalid credential/);
  });

  test("a revoked credential is rejected even with the correct secret", async () => {
    await prisma.codeCredential.updateMany({ where: { walletId }, data: { revokedAt: new Date() } });
    await assert.rejects(() => guard.canActivate(fakeContext({ "x-api-key": codeSecret })), /Invalid credential/);
  });

  test("rejects a WalletCredential secret outright - wrong prefix, never even queries the table", async () => {
    await assert.rejects(() => guard.canActivate(fakeContext({ "x-api-key": walletSecret })), /Missing or malformed credential/);
  });
});

describe("cross-guard isolation", () => {
  test("a CodeCredential secret is rejected by WalletCredentialGuard", async () => {
    const guard = new WalletCredentialGuard(prisma);
    await assert.rejects(() => guard.canActivate(fakeContext({ authorization: `Bearer ${codeSecret}` })), /Missing or malformed credential/);
  });

  test("a WalletCredential secret is rejected by CodeCredentialGuard", async () => {
    const guard = new CodeCredentialGuard(prisma);
    await assert.rejects(() => guard.canActivate(fakeContext({ authorization: `Bearer ${walletSecret}` })), /Missing or malformed credential/);
  });

  test("revoking the CodeCredential does not revoke the WalletCredential", async () => {
    await prisma.codeCredential.updateMany({ where: { walletId }, data: { revokedAt: new Date() } });
    const guard = new WalletCredentialGuard(prisma);
    const ctx = fakeContext({ authorization: `Bearer ${walletSecret}` });
    assert.equal(await guard.canActivate(ctx), true);
  });

  test("revoking the WalletCredential does not revoke the CodeCredential", async () => {
    await prisma.walletCredential.updateMany({ where: { walletId }, data: { revokedAt: new Date() } });
    const guard = new CodeCredentialGuard(prisma);
    const ctx = fakeContext({ authorization: `Bearer ${codeSecret}` });
    assert.equal(await guard.canActivate(ctx), true);
  });
});
