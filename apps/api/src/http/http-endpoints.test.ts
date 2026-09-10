import "reflect-metadata";
import test, { before, beforeEach, after, describe } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory, HttpAdapterHost } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { newId } from "@paymod/shared";
import { PrismaService } from "../common/prisma.service.js";
// bootstrapped from the compiled build, not raw src via tsx: NestJS's DI
// resolves constructor params from the `design:paramtypes` metadata `tsc`
// emits for decorators, and esbuild (tsx's transpiler) can't reliably emit
// that for a class used only as a cross-file type annotation - it degrades
// to a bare `Object` and DI silently injects nothing. Requires `npm run
// build` first, wired as this package's `pretest` script.
import { PaymodErrorFilter } from "../../dist/common/paymod-error.filter.js";
import { CommonModule } from "../../dist/common/common.module.js";
import { WalletsModule } from "../../dist/wallets/wallets.module.js";
import { PoliciesModule } from "../../dist/policies/policies.module.js";
import { AuthModule } from "../../dist/auth/auth.module.js";

/**
 * every other suite calls guards/services/repositories directly against
 * real Postgres (see settlement-intent-type.test.ts), which is exactly why
 * the `@Param("id")`-clobbering regression (TOFIX.md #2) slipped through: a
 * `@UsePipes()`/route-param bug only exists once a real HTTP request goes
 * through Nest's actual wiring. This boots a real Nest HTTP server (just
 * the Postgres-only modules) and drives it with `fetch`.
 *
 *   docker compose up -d
 *   npm --workspace @paymod/api run test
 */

@Module({ imports: [CommonModule, WalletsModule, PoliciesModule, AuthModule] })
class HttpTestModule {}

const BOOTSTRAP_TOKEN = "http-endpoints-test-bootstrap-token";
const prisma = new PrismaService();
let app: INestApplication;
let baseUrl: string;
const originalFetch = globalThis.fetch;

/**
 * `POST /v1/wallets` now provisions a real Circle wallet synchronously, so
 * this suite needs Circle credentials to boot its DI graph and a stubbed
 * Circle response to stay hermetic. Only requests aimed at Circle's API
 * are intercepted; the suite's own calls to its local `app` pass through
 * to the real `fetch` unchanged.
 */
function stubCircleWalletCreation() {
  globalThis.fetch = (async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith("https://api.circle.com/")) return originalFetch(input, init);
    return new Response(
      JSON.stringify({
        data: {
          wallets: [
            {
              id: `circle-wallet-${randomBytes(8).toString("hex")}`,
              address: `0x${randomBytes(20).toString("hex")}`,
              blockchain: "BASE-SEPOLIA",
              state: "LIVE",
              walletSetId: "test-wallet-set",
              custodyType: "DEVELOPER",
            },
          ],
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
}

before(async () => {
  process.env["PAYMOD_BOOTSTRAP_TOKEN"] = BOOTSTRAP_TOKEN;
  process.env["CIRCLE_API_KEY"] = "test-circle-api-key";
  process.env["CIRCLE_ENTITY_SECRET"] = randomBytes(32).toString("hex");
  process.env["CIRCLE_ENTITY_PUBLIC_KEY"] = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ type: "spki", format: "pem" }).toString();
  process.env["CIRCLE_WALLET_SET_ID"] = "test-wallet-set";
  process.env["CIRCLE_BLOCKCHAIN"] = "BASE-SEPOLIA";
  process.env["CIRCLE_USDC_TOKEN_ID"] = "test-usdc-token-id";
  stubCircleWalletCreation();
  await prisma.$connect();

  app = await NestFactory.create(HttpTestModule, { logger: false });
  app.use(cookieParser());
  app.useGlobalFilters(new PaymodErrorFilter(app.get(HttpAdapterHost)));
  await app.listen(0);
  const address = app.getHttpServer().address();
  baseUrl = `http://127.0.0.1:${address.port}`;
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
});

after(async () => {
  await resetDatabase();
  await app.close();
  await prisma.$disconnect();
  globalThis.fetch = originalFetch;
});

/** A bootstrap-token-created account and wallet: the CLI/ops path, unaffected by session RBAC. */
async function bootstrapAccountAndWallet(): Promise<{ accountId: string; walletId: string }> {
  const userId = newId("user");
  const accountId = newId("account");
  await prisma.user.create({ data: { id: userId, email: `${userId}@test.paymod.dev`, passwordHash: "x", name: "Bootstrap" } });
  await prisma.account.create({ data: { id: accountId, userId, name: "Test" } });

  const walletRes = await fetch(`${baseUrl}/v1/wallets`, {
    method: "POST",
    headers: { authorization: `Bearer ${BOOTSTRAP_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ accountId, name: "Agent" }),
  });
  const wallet = (await walletRes.json()) as { id: string };
  return { accountId, walletId: wallet.id };
}

async function signupAndGetSession(email: string, name: string): Promise<{ cookie: string; accountId: string; userId: string }> {
  const signupRes = await fetch(`${baseUrl}/v1/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "correct-horse-battery-staple", name }),
  });
  assert.equal(signupRes.status, 201);
  const setCookie = signupRes.headers.get("set-cookie");
  assert.ok(setCookie, "signup must set a session cookie");
  const cookie = setCookie!.split(";")[0]!;

  const meRes = await fetch(`${baseUrl}/v1/auth/me`, { headers: { cookie } });
  const me = (await meRes.json()) as { user: { id: string }; account: { accountId: string } };
  return { cookie, accountId: me.account.accountId, userId: me.user.id };
}

describe("POST /v1/wallets/:id/credentials through the real HTTP pipeline", () => {
  test("no body and no Content-Type resolves the real wallet, not the clobbered {} from TOFIX #2", async () => {
    const { walletId } = await bootstrapAccountAndWallet();

    const res = await fetch(`${baseUrl}/v1/wallets/${walletId}/credentials`, {
      method: "POST",
      headers: { authorization: `Bearer ${BOOTSTRAP_TOKEN}` },
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { id: string; secret: string };

    const credential = await prisma.walletCredential.findUniqueOrThrow({ where: { id: body.id } });
    assert.equal(credential.walletId, walletId, "the pipe must not have coerced the route param");
  });

  test("a matching accountId body still resolves the same wallet", async () => {
    const { accountId, walletId } = await bootstrapAccountAndWallet();

    const res = await fetch(`${baseUrl}/v1/wallets/${walletId}/credentials`, {
      method: "POST",
      headers: { authorization: `Bearer ${BOOTSTRAP_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ accountId }),
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { id: string };
    const credential = await prisma.walletCredential.findUniqueOrThrow({ where: { id: body.id } });
    assert.equal(credential.walletId, walletId);
  });

  test("a mismatched accountId body 404s rather than issuing a credential for the wrong account", async () => {
    const { walletId } = await bootstrapAccountAndWallet();

    const res = await fetch(`${baseUrl}/v1/wallets/${walletId}/credentials`, {
      method: "POST",
      headers: { authorization: `Bearer ${BOOTSTRAP_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ accountId: "acc_someone_else" }),
    });
    assert.equal(res.status, 404);
  });
});

describe("GET /v1/wallets/:id", () => {
  test("resolves the wallet for its own account", async () => {
    const { accountId, walletId } = await bootstrapAccountAndWallet();

    const res = await fetch(`${baseUrl}/v1/wallets/${walletId}?accountId=${accountId}`, {
      headers: { authorization: `Bearer ${BOOTSTRAP_TOKEN}` },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { id: string };
    assert.equal(body.id, walletId);
  });

  test("404s when the wallet does not belong to the given account", async () => {
    const { walletId } = await bootstrapAccountAndWallet();
    const { accountId: otherAccountId } = await bootstrapAccountAndWallet();

    const res = await fetch(`${baseUrl}/v1/wallets/${walletId}?accountId=${otherAccountId}`, {
      headers: { authorization: `Bearer ${BOOTSTRAP_TOKEN}` },
    });
    assert.equal(res.status, 404);
  });
});

describe("Cross-account access through the real HTTP pipeline", () => {
  test("a signed-in user can write their own account's policy", async () => {
    const owner = await signupAndGetSession("owner-a@test.paymod.dev", "Owner A");

    const res = await fetch(`${baseUrl}/v1/policies`, {
      method: "PUT",
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      body: JSON.stringify({ accountId: owner.accountId, walletId: null, type: "DAILY_LIMIT", config: { limitAtomic: "1000000" } }),
    });
    assert.equal(res.status, 200);
  });

  test("a signed-in user cannot write a policy onto an account they do not belong to", async () => {
    const owner = await signupAndGetSession("owner-b@test.paymod.dev", "Owner B");
    const other = await signupAndGetSession("owner-c@test.paymod.dev", "Owner C");

    const res = await fetch(`${baseUrl}/v1/policies`, {
      method: "PUT",
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      body: JSON.stringify({ accountId: other.accountId, walletId: null, type: "DAILY_LIMIT", config: { limitAtomic: "1000000" } }),
    });
    assert.equal(res.status, 403);

    const policies = await prisma.policy.findMany({ where: { accountId: other.accountId } });
    assert.equal(policies.length, 0, "the cross-account write must not have landed");
  });

  test("a signed-in user can read their own account's wallets but not another account's", async () => {
    const { accountId: mineAccountId } = await bootstrapAccountAndWallet();
    const owner = await signupAndGetSession("reader@test.paymod.dev", "Reader");

    const own = await fetch(`${baseUrl}/v1/wallets?accountId=${owner.accountId}`, { headers: { cookie: owner.cookie } });
    assert.equal(own.status, 200);

    const cross = await fetch(`${baseUrl}/v1/wallets?accountId=${mineAccountId}`, { headers: { cookie: owner.cookie } });
    assert.equal(cross.status, 403);
  });

  test("no session and no bootstrap token is rejected before reaching the handler", async () => {
    const { accountId } = await bootstrapAccountAndWallet();
    const res = await fetch(`${baseUrl}/v1/wallets?accountId=${accountId}`);
    assert.equal(res.status, 401);
  });

  test("the bootstrap token still writes a policy for any account, unaffected by session RBAC", async () => {
    const { accountId } = await bootstrapAccountAndWallet();

    const res = await fetch(`${baseUrl}/v1/policies`, {
      method: "PUT",
      headers: { authorization: `Bearer ${BOOTSTRAP_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ accountId, walletId: null, type: "DAILY_LIMIT", config: { limitAtomic: "1000000" } }),
    });
    assert.equal(res.status, 200);
  });
});

describe("Dashboard actions are audited", () => {
  test("signup writes ACCOUNT_CREATED and login writes USER_LOGGED_IN", async () => {
    const owner = await signupAndGetSession("audit-signup@test.paymod.dev", "Owner");

    const afterSignup = await prisma.auditEvent.findMany({ where: { accountId: owner.accountId } });
    assert.deepEqual(afterSignup.map((e) => e.action), ["ACCOUNT_CREATED"]);

    const loginRes = await fetch(`${baseUrl}/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "audit-signup@test.paymod.dev", password: "correct-horse-battery-staple" }),
    });
    assert.equal(loginRes.status, 201);

    const afterLogin = await prisma.auditEvent.findMany({ where: { accountId: owner.accountId }, orderBy: { createdAt: "asc" } });
    assert.deepEqual(afterLogin.map((e) => e.action), ["ACCOUNT_CREATED", "USER_LOGGED_IN"]);
  });

  test("creating a wallet writes WALLET_CREATED", async () => {
    const owner = await signupAndGetSession("audit-wallet@test.paymod.dev", "Owner");

    const res = await fetch(`${baseUrl}/v1/wallets`, {
      method: "POST",
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      body: JSON.stringify({ accountId: owner.accountId, name: "Agent" }),
    });
    assert.equal(res.status, 201);
    const wallet = (await res.json()) as { id: string };

    const events = await prisma.auditEvent.findMany({ where: { accountId: owner.accountId, action: "WALLET_CREATED" } });
    assert.equal(events.length, 1);
    assert.equal(events[0]!.targetId, wallet.id);
    assert.equal(events[0]!.actorId, owner.userId);
  });

  test("upserting a policy writes POLICY_CREATED, then POLICY_UPDATED on the same id", async () => {
    const owner = await signupAndGetSession("audit-policy@test.paymod.dev", "Owner");

    const createRes = await fetch(`${baseUrl}/v1/policies`, {
      method: "PUT",
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      body: JSON.stringify({ accountId: owner.accountId, walletId: null, type: "DAILY_LIMIT", config: { limitAtomic: "1000000" } }),
    });
    const policy = (await createRes.json()) as { id: string };

    const updateRes = await fetch(`${baseUrl}/v1/policies`, {
      method: "PUT",
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      body: JSON.stringify({ id: policy.id, accountId: owner.accountId, walletId: null, type: "DAILY_LIMIT", config: { limitAtomic: "2000000" } }),
    });
    assert.equal(updateRes.status, 200);

    const events = await prisma.auditEvent.findMany({
      where: { accountId: owner.accountId, targetId: policy.id },
      orderBy: { createdAt: "asc" },
    });
    assert.deepEqual(events.map((e) => e.action), ["POLICY_CREATED", "POLICY_UPDATED"]);
  });
});
