import test, { describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import type { ModuleRef } from "@nestjs/core";
import type { Account, AgentWallet, WalletAsset } from "@paymod/database";
import type { PaymentRequirements } from "@paymod/x402";
import { CircleApiClient } from "@paymod/circle";
import { PrismaService } from "../common/prisma.service.js";
import { AuditService } from "../audit/audit.service.js";
import type { ApprovalService } from "../approvals/approval.service.js";
import { X402Service, type X402Context } from "./x402.service.js";
import type { StellarX402Signer } from "./stellar-x402.provider.js";
import type { CircleX402Signer } from "./circle-x402.provider.js";

/**
 * `X402Service.buildPaymentPayload` is where a Circle-rail vs Stellar-rail
 * wallet actually diverges - real wiring risk even though the primitives
 * it calls (`signTransferAuthorization`, `buildSignedX402Transaction`) are
 * already tested on their own. No Postgres dependency: it only touches
 * `ctx` and the injected signers.
 */

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const { publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const circleSigner: CircleX402Signer = {
  client: new CircleApiClient({ apiKey: "test-key" }),
  entitySecretHex: "a".repeat(64),
  entityPublicKeyPem: publicKey,
  chainId: 11155111,
  tokenAddress: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  rpcUrl: "https://rpc.test",
};

const service = new X402Service(
  {} as PrismaService,
  {} as AuditService,
  {} as StellarX402Signer,
  circleSigner,
  {} as ApprovalService,
  {} as ModuleRef,
);
const buildPaymentPayload = (
  service as unknown as {
    buildPaymentPayload: (ctx: X402Context) => Promise<{ ok: true; payload: unknown } | { ok: false; reason: string }>;
  }
).buildPaymentPayload.bind(service);

const account = { id: "acc_1", status: "ACTIVE" } as Account;

function circleWallet(overrides: Partial<AgentWallet> = {}): AgentWallet & { assets: WalletAsset[] } {
  return {
    id: "wal_1",
    accountId: "acc_1",
    name: "Agent",
    description: null,
    status: "ACTIVE",
    source: null,
    rail: "CIRCLE",
    networkId: "eip155:11155111",
    contractId: null,
    ownerAddress: "0xPayer",
    executorAddress: null,
    externalWalletId: "circle-wallet-1",
    createdAt: new Date(),
    updatedAt: new Date(),
    assets: [],
    ...overrides,
  } as AgentWallet & { assets: WalletAsset[] };
}

const evmRequirement: PaymentRequirements = {
  scheme: "exact",
  network: "eip155:11155111",
  amount: "1000000",
  asset: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  payTo: "0xMerchant",
  maxTimeoutSeconds: 60,
  extra: { assetTransferMethod: "eip3009", name: "USDC", version: "2" },
};

describe("X402Service.buildPaymentPayload - Circle branch", () => {
  test("a Circle-rail wallet (externalWalletId, no contractId) signs an eip3009 authorization, not a Stellar transaction", async () => {
    let capturedData: Record<string, unknown> = {};
    globalThis.fetch = (async (_url, init) => {
      capturedData = JSON.parse((init as RequestInit).body as string);
      return jsonResponse({ data: { signature: "0xsig" } });
    }) as typeof fetch;

    const ctx: X402Context = { account, wallet: circleWallet(), requirement: evmRequirement, url: "https://merchant.test/resource", requestId: "req_1", intentId: "int_1" };
    const result = await buildPaymentPayload(ctx);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    const payload = result.payload as { signature: string; authorization: { from: string; nonce: string } };
    assert.equal(payload.signature, "0xsig");
    assert.equal(payload.authorization.from, "0xPayer");
    assert.equal(capturedData["walletId"], "circle-wallet-1");
  });

  test("the nonce is deterministic from intentId - two calls for the same intent sign the identical nonce", async () => {
    globalThis.fetch = (async () => jsonResponse({ data: { signature: "0xsig" } })) as typeof fetch;
    const ctx: X402Context = { account, wallet: circleWallet(), requirement: evmRequirement, url: "https://merchant.test/resource", requestId: "req_1", intentId: "int_stable" };

    const first = await buildPaymentPayload(ctx);
    const second = await buildPaymentPayload(ctx);

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (!first.ok || !second.ok) return;
    const firstNonce = (first.payload as { authorization: { nonce: string } }).authorization.nonce;
    const secondNonce = (second.payload as { authorization: { nonce: string } }).authorization.nonce;
    assert.equal(firstNonce, secondNonce);
  });

  test("a different intentId produces a different nonce", async () => {
    globalThis.fetch = (async () => jsonResponse({ data: { signature: "0xsig" } })) as typeof fetch;
    const ctxA: X402Context = { account, wallet: circleWallet(), requirement: evmRequirement, url: "https://merchant.test/resource", requestId: "req_1", intentId: "int_a" };
    const ctxB: X402Context = { account, wallet: circleWallet(), requirement: evmRequirement, url: "https://merchant.test/resource", requestId: "req_2", intentId: "int_b" };

    const a = await buildPaymentPayload(ctxA);
    const b = await buildPaymentPayload(ctxB);

    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    if (!a.ok || !b.ok) return;
    const nonceA = (a.payload as { authorization: { nonce: string } }).authorization.nonce;
    const nonceB = (b.payload as { authorization: { nonce: string } }).authorization.nonce;
    assert.notEqual(nonceA, nonceB);
  });

  test("fails cleanly when the requirement is missing extra.name/extra.version, rather than signing a malformed domain", async () => {
    globalThis.fetch = (async () => jsonResponse({ data: { signature: "0xsig" } })) as typeof fetch;
    const badRequirement: PaymentRequirements = { ...evmRequirement, extra: { assetTransferMethod: "eip3009" } };
    const ctx: X402Context = { account, wallet: circleWallet(), requirement: badRequirement, url: "https://merchant.test/resource", requestId: "req_1", intentId: "int_1" };

    const result = await buildPaymentPayload(ctx);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /extra\.name/);
  });

  test("fails cleanly when the wallet has no on-chain address yet", async () => {
    globalThis.fetch = (async () => jsonResponse({ data: { signature: "0xsig" } })) as typeof fetch;
    const ctx: X402Context = { account, wallet: circleWallet({ ownerAddress: null }), requirement: evmRequirement, url: "https://merchant.test/resource", requestId: "req_1", intentId: "int_1" };

    const result = await buildPaymentPayload(ctx);

    assert.equal(result.ok, false);
  });
});
