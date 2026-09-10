import test, { before, beforeEach, after, describe } from "node:test";
import assert from "node:assert/strict";
import { newId, PaymodError } from "@paymod/shared";
import { PrismaService } from "../common/prisma.service.js";
import { AuditService } from "../audit/audit.service.js";
import { DeviceAuthService } from "./device-auth.service.js";

/**
 * Exercises the full start -> approve -> poll -> consume lifecycle against a
 * real Postgres session, mirroring `wallet-credential-guard.test.ts`'s style.
 *
 *   docker compose up -d
 *   npm --workspace @paymod/api run test
 */

const prisma = new PrismaService();
const audit = new AuditService(prisma);
const service = new DeviceAuthService(prisma, audit);

let accountId: string;

before(async () => {
  await prisma.$connect();
});

async function resetDatabase() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "device_auth_requests", "sessions", "users",
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
});

after(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

describe("DeviceAuthService", () => {
  test("a fresh request is pending until approved", async () => {
    const { deviceCode } = await service.start();
    assert.deepEqual(await service.poll(deviceCode), { status: "pending" });
  });

  test("approve then poll mints a credential exactly once, for a lazily-created Coding Agent Wallet", async () => {
    const { deviceCode, userCode } = await service.start();
    await service.approve(accountId, userCode);

    const approved = await service.poll(deviceCode);
    assert.equal(approved.status, "approved");
    assert.match((approved as { credential: string }).credential, /^pmcode_/);

    const wallet = await prisma.agentWallet.findFirst({ where: { accountId, source: "PAYMOD_CODE" } });
    assert.ok(wallet, "a Coding Agent Wallet should have been created");
    assert.equal(wallet!.status, "CREATING");

    const credentialRow = await prisma.codeCredential.findFirst({ where: { walletId: wallet!.id } });
    assert.ok(credentialRow, "should mint a CodeCredential row, not a WalletCredential");
    const walletCredentialRow = await prisma.walletCredential.findFirst({ where: { walletId: wallet!.id } });
    assert.equal(walletCredentialRow, null, "the device-auth flow must never mint a WalletCredential");

    // consumed: a replayed poll can never re-read the credential.
    assert.deepEqual(await service.poll(deviceCode), { status: "expired" });
  });

  test("approving a second device request for the same account reuses the existing Coding Agent Wallet", async () => {
    const first = await service.start();
    await service.approve(accountId, first.userCode);
    await service.poll(first.deviceCode);

    const second = await service.start();
    await service.approve(accountId, second.userCode);
    await service.poll(second.deviceCode);

    const wallets = await prisma.agentWallet.findMany({ where: { accountId, source: "PAYMOD_CODE" } });
    assert.equal(wallets.length, 1);
  });

  test("deny is reflected on the next poll and cannot later be approved", async () => {
    const { deviceCode, userCode } = await service.start();
    await service.deny(accountId, userCode);
    assert.deepEqual(await service.poll(deviceCode), { status: "denied" });
    await assert.rejects(() => service.approve(accountId, userCode), PaymodError);
  });

  test("an unknown device code is rejected", async () => {
    await assert.rejects(() => service.poll(`pmdev_${"0".repeat(48)}`), PaymodError);
  });

  test("an unknown or already-resolved user code cannot be approved twice", async () => {
    const { userCode } = await service.start();
    await service.approve(accountId, userCode);
    await assert.rejects(() => service.approve(accountId, userCode), PaymodError);
  });

  test("an expired request reports expired instead of pending", async () => {
    const { deviceCode, userCode } = await service.start();
    await prisma.deviceAuthRequest.update({ where: { userCode }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.deepEqual(await service.poll(deviceCode), { status: "expired" });
  });
});
