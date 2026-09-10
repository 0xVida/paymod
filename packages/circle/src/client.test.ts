import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { CircleApiClient, CircleApiError } from "./client.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("createWallet posts to /developer/wallets and returns the first created wallet", async () => {
  let capturedUrl = "";
  let capturedBody: unknown;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    capturedUrl = url;
    capturedBody = JSON.parse(init!.body as string);
    return jsonResponse(200, {
      data: {
        wallets: [{ id: "wal_1", address: "0xabc", blockchain: "BASE-SEPOLIA", state: "LIVE", walletSetId: "ws_1", custodyType: "DEVELOPER" }],
      },
    });
  }) as typeof fetch;

  const client = new CircleApiClient({ apiKey: "test-key" });
  const wallet = await client.createWallet({
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
    entitySecretCiphertext: "ciphertext",
    walletSetId: "ws_1",
    blockchain: "BASE-SEPOLIA",
  });

  assert.equal(wallet.id, "wal_1");
  assert.match(capturedUrl, /\/developer\/wallets$/);
  assert.deepEqual((capturedBody as { blockchains: string[] }).blockchains, ["BASE-SEPOLIA"]);
});

test("createWallet throws when Circle returns no wallets", async () => {
  globalThis.fetch = (async () => jsonResponse(200, { data: { wallets: [] } })) as typeof fetch;
  const client = new CircleApiClient({ apiKey: "test-key" });
  await assert.rejects(() =>
    client.createWallet({
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      entitySecretCiphertext: "ciphertext",
      walletSetId: "ws_1",
      blockchain: "BASE-SEPOLIA",
    }),
  );
});

test("a non-ok response raises CircleApiError carrying Circle's own error code and message", async () => {
  globalThis.fetch = (async () => jsonResponse(400, { code: 155101, message: "Invalid entity secret ciphertext" })) as typeof fetch;
  const client = new CircleApiClient({ apiKey: "test-key" });

  await assert.rejects(
    () => client.getWallet("wal_1"),
    (err: unknown) => {
      assert.ok(err instanceof CircleApiError);
      assert.equal(err.httpStatus, 400);
      assert.equal(err.circleErrorCode, 155101);
      assert.equal(err.message, "Invalid entity secret ciphertext");
      return true;
    },
  );
});

test("createTransfer submits then fetches the created transaction by id", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    calls.push(url);
    if (url.endsWith("/developer/transactions/transfer")) {
      return jsonResponse(201, { data: { id: "tx_1", state: "INITIATED" } });
    }
    return jsonResponse(200, {
      data: { transaction: { id: "tx_1", state: "INITIATED", updateDate: "2026-09-06T00:00:00.000Z" } },
    });
  }) as typeof fetch;

  const client = new CircleApiClient({ apiKey: "test-key" });
  const record = await client.createTransfer({
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
    entitySecretCiphertext: "ciphertext",
    walletId: "wal_1",
    destinationAddress: "0xdest",
    tokenId: "tok_1",
    amount: "1.5",
  });

  assert.equal(record.id, "tx_1");
  assert.equal(record.state, "INITIATED");
  assert.equal(calls.length, 2);
});
