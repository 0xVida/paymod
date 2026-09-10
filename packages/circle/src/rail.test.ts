import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import type { SettlementIntent } from "@paymod/payments";
import { CircleWalletRail } from "./rail.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const { publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

function newRail(): CircleWalletRail {
  return new CircleWalletRail({
    network: "eip155:84532",
    blockchain: "BASE-SEPOLIA",
    tokenId: "tok_usdc_base_sepolia",
    apiKey: "test-key",
    walletSetId: "ws_1",
    entitySecretHex: "a".repeat(64),
    entityPublicKeyPem: publicKey,
  });
}

function fakeIntent(overrides: Partial<SettlementIntent> = {}): SettlementIntent {
  return {
    intentId: "int_1",
    requestId: "req_1",
    accountId: "acc_1",
    walletId: "wal_1",
    externalWalletId: "wal_circle_1",
    networkId: "eip155:84532",
    assetCode: "USDC",
    atomicAmount: "1500000",
    destination: "0x1234567890abcdef1234567890abcdef12345678",
    paymentId: "a".repeat(64),
    expiresAt: new Date(Date.now() + 60_000),
    metadata: {},
    ...overrides,
  };
}

test("validateDestination accepts EVM addresses and rejects everything else", () => {
  const rail = newRail();
  assert.equal(rail.validateDestination("0x1234567890abcdef1234567890abcdef12345678"), true);
  assert.equal(rail.validateDestination("GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"), false);
});

test("prepare rejects an invalid destination before touching the network", async () => {
  const rail = newRail();
  let fetchCalled = false;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    throw new Error("must not be called");
  }) as typeof fetch;

  await assert.rejects(() => rail.prepare(fakeIntent({ destination: "not-an-address" })));
  assert.equal(fetchCalled, false);
});

test("prepare produces a deterministic idempotency key from the intent's paymentId", async () => {
  const rail = newRail();
  const intent = fakeIntent();
  const first = await rail.prepare(intent);
  const second = await rail.prepare(intent);
  const firstPayload = first.payload as { idempotencyKey: string };
  const secondPayload = second.payload as { idempotencyKey: string };
  assert.equal(firstPayload.idempotencyKey, secondPayload.idempotencyKey);
});

test("submit posts the prepared payload and confirm maps a CONFIRMED transaction to a CONFIRMED outcome", async () => {
  const rail = newRail();
  const intent = fakeIntent();
  const prepared = await rail.prepare(intent);

  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    calls.push(url);
    if (url.endsWith("/developer/transactions/transfer")) {
      return jsonResponse(201, { data: { id: "tx_1", state: "INITIATED" } });
    }
    return jsonResponse(200, {
      data: { transaction: { id: "tx_1", state: "CONFIRMED", txHash: "0xhash", updateDate: "2026-09-06T00:00:00.000Z" } },
    });
  }) as typeof fetch;

  const submission = await rail.submit(prepared);
  assert.equal(submission.txRef, "tx_1");
  assert.equal(calls.length, 2);

  const outcome = await rail.confirm(submission);
  assert.equal(outcome.status, "CONFIRMED");
  if (outcome.status === "CONFIRMED") {
    assert.equal(outcome.actualAtomic, "1500000");
    assert.equal(outcome.txRef, "0xhash");
  }
  assert.equal(calls.length, 3);
});

test("confirm never trusts a cached result, it always re-fetches the transaction", async () => {
  const rail = newRail();
  let getTransactionCalls = 0;
  globalThis.fetch = (async () => {
    getTransactionCalls++;
    return jsonResponse(200, {
      data: { transaction: { id: "tx_1", state: "STUCK", updateDate: "2026-09-06T00:00:00.000Z" } },
    });
  }) as typeof fetch;

  const outcome = await rail.confirm({
    intentId: "int_1",
    networkId: "eip155:84532",
    paymentId: "a".repeat(64),
    requestedAtomicAmount: "1500000",
    txRef: "tx_1",
    submittedAt: new Date(),
  });

  assert.equal(outcome.status, "UNKNOWN");
  assert.equal(getTransactionCalls, 1);
});

test("readWalletState reports paused when the wallet is not LIVE, and 0 balance when USDC is absent", async () => {
  const rail = newRail();
  globalThis.fetch = (async (url: string) => {
    if (url.endsWith("/balances")) {
      return jsonResponse(200, { data: { tokenBalances: [] } });
    }
    return jsonResponse(200, {
      data: { wallet: { id: "wal_circle_1", address: "0xabc", blockchain: "BASE-SEPOLIA", state: "FROZEN", walletSetId: "ws_1", custodyType: "DEVELOPER" } },
    });
  }) as typeof fetch;

  const state = await rail.readWalletState("wal_circle_1");
  assert.equal(state.paused, true);
  assert.equal(state.balanceAtomic, "0");
});
