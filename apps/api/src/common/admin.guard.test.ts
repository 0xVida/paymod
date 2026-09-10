import test, { before, beforeEach, after, describe } from "node:test";
import assert from "node:assert/strict";
import type { ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import { newId } from "@paymod/shared";
import { PrismaService } from "./prisma.service.js";
import { AdminGuard, requireRecentAuth } from "./admin.guard.js";
import { generateSessionToken } from "../auth/session-token.js";

/**
 * real Postgres, same style as `rbac-guards.test.ts`. `ADMIN_USER_IDS` is
 * set to `adminUserId` only - `otherUserId` proves a valid, non-expired
 * session that simply isn't on the allowlist is forbidden, not treated as
 * unauthenticated.
 *
 *   docker compose up -d
 *   npm --workspace @paymod/api run test
 */

const prisma = new PrismaService();

let adminUserId: string;
let otherUserId: string;
let adminCookie: string;
let otherCookie: string;

function fakeContext(req: Partial<Request>): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

function requestWith(cookie?: string): Partial<Request> {
  return { cookies: cookie ? { paymod_session: cookie } : {}, headers: {} } as Partial<Request>;
}

async function createSession(userId: string, createdAt = new Date()): Promise<string> {
  const { token, prefix, hash } = generateSessionToken();
  await prisma.session.create({
    data: { id: newId("session"), userId, prefix, hash, expiresAt: new Date(Date.now() + 3_600_000), createdAt },
  });
  return token;
}

before(async () => {
  await prisma.$connect();
});

async function resetDatabase() {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "sessions", "users", "accounts" RESTART IDENTITY CASCADE`);
}

beforeEach(async () => {
  await resetDatabase();

  adminUserId = newId("user");
  otherUserId = newId("user");
  await prisma.user.create({ data: { id: adminUserId, email: "admin@test.paymod.dev", passwordHash: "x", name: "Admin" } });
  await prisma.account.create({ data: { id: newId("account"), userId: adminUserId, name: "Admin's account" } });
  await prisma.user.create({ data: { id: otherUserId, email: "other@test.paymod.dev", passwordHash: "x", name: "Other" } });
  await prisma.account.create({ data: { id: newId("account"), userId: otherUserId, name: "Other's account" } });

  process.env.ADMIN_USER_IDS = adminUserId;
  adminCookie = await createSession(adminUserId);
  otherCookie = await createSession(otherUserId);
});

after(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

describe("AdminGuard", () => {
  const guard = new AdminGuard(prisma);

  test("no session is unauthorized, not forbidden", async () => {
    await assert.rejects(() => guard.canActivate(fakeContext(requestWith())), /Not signed in/);
  });

  test("a valid session not on the allowlist is forbidden", async () => {
    await assert.rejects(() => guard.canActivate(fakeContext(requestWith(otherCookie))), /Not an admin/);
  });

  test("a valid session on the allowlist is allowed through", async () => {
    const req = requestWith(adminCookie);
    assert.equal(await guard.canActivate(fakeContext(req)), true);
    assert.equal((req as Request).paymodUser?.user.id, adminUserId);
  });
});

describe("requireRecentAuth", () => {
  test("a session issued just now passes", async () => {
    const req = requestWith(adminCookie) as Request;
    await assert.doesNotReject(() => requireRecentAuth(prisma, req));
  });

  test("a session issued outside the freshness window is rejected", async () => {
    const staleCookie = await createSession(adminUserId, new Date(Date.now() - 20 * 60 * 1000));
    const req = requestWith(staleCookie) as Request;
    await assert.rejects(() => requireRecentAuth(prisma, req), /Re-authenticate/);
  });

  test("no session at all is unauthorized, not forbidden", async () => {
    const req = requestWith() as Request;
    await assert.rejects(() => requireRecentAuth(prisma, req), /Not signed in/);
  });
});
