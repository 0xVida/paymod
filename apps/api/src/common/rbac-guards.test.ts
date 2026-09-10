import test, { before, beforeEach, after, describe } from "node:test";
import assert from "node:assert/strict";
import type { ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import { newId } from "@paymod/shared";
import { PrismaService } from "./prisma.service.js";
import { BootstrapOrAccountGuard } from "./bootstrap-or-account.guard.js";
import { generateSessionToken } from "../auth/session-token.js";

/**
 * `BootstrapOrAccountGuard` is the RBAC enforcement point (see its own
 * docblock). These tests exercise every branch against a real Postgres
 * session/account row rather than a mocked guard dependency.
 *
 *   docker compose up -d
 *   npm --workspace @paymod/api run test
 */

const prisma = new PrismaService();
const BOOTSTRAP_TOKEN = "test-bootstrap-token";

let ownAccountId: string;
let otherAccountId: string;
let ownCookie: string;
let expiredCookie: string;

function fakeContext(req: Partial<Request>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function requestWith(opts: { cookie?: string; authorization?: string; body?: unknown }): Partial<Request> {
  return {
    cookies: opts.cookie ? { paymod_session: opts.cookie } : {},
    headers: opts.authorization ? { authorization: opts.authorization } : {},
    body: opts.body,
    query: {},
    params: {},
  } as Partial<Request>;
}

async function createSession(userId: string, expiresAt = new Date(Date.now() + 3_600_000)): Promise<string> {
  const { token, prefix, hash } = generateSessionToken();
  await prisma.session.create({
    data: { id: newId("session"), userId, prefix, hash, expiresAt },
  });
  return token;
}

before(async () => {
  process.env.PAYMOD_BOOTSTRAP_TOKEN = BOOTSTRAP_TOKEN;
  await prisma.$connect();
});

async function resetDatabase() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "sessions", "users",
      "chain_tx_attempts", "settlements", "spend_reservations", "budget_periods",
      "financial_intents", "wallet_assets", "wallet_credentials",
      "policies", "agent_wallets", "audit_events", "idempotency_records", "accounts"
    RESTART IDENTITY CASCADE
  `);
}

beforeEach(async () => {
  await resetDatabase();

  ownAccountId = newId("account");
  otherAccountId = newId("account");

  const ownUserId = newId("user");
  await prisma.user.create({
    data: { id: ownUserId, email: "owner@test.paymod.dev", passwordHash: "irrelevant", name: "Owner" },
  });
  await prisma.account.create({ data: { id: ownAccountId, userId: ownUserId, name: "Owner's account" } });
  ownCookie = await createSession(ownUserId);

  const otherUserId = newId("user");
  await prisma.user.create({
    data: { id: otherUserId, email: "other@test.paymod.dev", passwordHash: "irrelevant", name: "Other" },
  });
  await prisma.account.create({ data: { id: otherAccountId, userId: otherUserId, name: "Someone else's account" } });

  expiredCookie = await createSession(ownUserId, new Date(Date.now() - 1000));
});

after(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

describe("BootstrapOrAccountGuard", () => {
  const guard = new BootstrapOrAccountGuard(prisma);

  test("the bootstrap token bypasses everything, including a nonexistent account", async () => {
    const ctx = fakeContext(requestWith({ authorization: `Bearer ${BOOTSTRAP_TOKEN}`, body: { accountId: "acc_does_not_exist" } }));
    assert.equal(await guard.canActivate(ctx), true);
  });

  test("a wrong bootstrap token is rejected, not silently treated as a session lookup", async () => {
    const ctx = fakeContext(requestWith({ authorization: "Bearer wrong-token" }));
    await assert.rejects(() => guard.canActivate(ctx), /Not signed in/);
  });

  test("no cookie and no bootstrap token is unauthorized, not forbidden", async () => {
    const ctx = fakeContext(requestWith({ body: { accountId: ownAccountId } }));
    await assert.rejects(() => guard.canActivate(ctx), /Not signed in/);
  });

  test("an expired session is treated the same as no session", async () => {
    const ctx = fakeContext(requestWith({ cookie: expiredCookie, body: { accountId: ownAccountId } }));
    await assert.rejects(() => guard.canActivate(ctx), /Not signed in/);
  });

  test("a tampered session token is rejected even with a matching prefix", async () => {
    const tampered = ownCookie.slice(0, -2) + "00";
    const ctx = fakeContext(requestWith({ cookie: tampered, body: { accountId: ownAccountId } }));
    await assert.rejects(() => guard.canActivate(ctx), /Not signed in/);
  });

  test("a valid session naming another account is forbidden", async () => {
    const ctx = fakeContext(requestWith({ cookie: ownCookie, body: { accountId: otherAccountId } }));
    await assert.rejects(() => guard.canActivate(ctx), /No access to this account/);
  });

  test("a valid session on its own account is allowed through", async () => {
    const ctx = fakeContext(requestWith({ cookie: ownCookie, body: { accountId: ownAccountId } }));
    assert.equal(await guard.canActivate(ctx), true);
  });
});
