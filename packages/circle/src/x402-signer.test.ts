import test, { describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { CircleApiClient } from "./client.js";
import { isAuthorizationUsed, signTransferAuthorization } from "./x402-signer.js";

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

describe("signTransferAuthorization", () => {
  test("builds a byte-exact ERC-3009 typed-data request and returns the x402 EIP-3009 payload shape", async () => {
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = (async (_url, init) => {
      capturedBody = JSON.parse((init as RequestInit).body as string);
      return jsonResponse({ data: { signature: "2d6a7588d6acca50" } });
    }) as typeof fetch;

    const client = new CircleApiClient({ apiKey: "test-key" });
    const payload = await signTransferAuthorization({
      client,
      walletId: "wal_circle_1",
      entitySecretHex: "a".repeat(64),
      entityPublicKeyPem: publicKey,
      chainId: 11155111,
      tokenAddress: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
      tokenName: "USDC",
      tokenVersion: "2",
      from: "0xFrom",
      to: "0xTo",
      atomicAmount: "1000000",
      maxTimeoutSeconds: 60,
      nonce: "0x" + "1".repeat(64),
    });

    assert.equal(capturedBody["walletId"], "wal_circle_1");
    assert.ok(typeof capturedBody["entitySecretCiphertext"] === "string" && (capturedBody["entitySecretCiphertext"] as string).length > 0);

    const typedData = JSON.parse(capturedBody["data"] as string);
    assert.equal(typedData.primaryType, "TransferWithAuthorization");
    assert.deepEqual(typedData.domain, { name: "USDC", version: "2", chainId: 11155111, verifyingContract: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" });
    assert.deepEqual(
      typedData.types.TransferWithAuthorization,
      [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
      "must match ERC-3009's TransferWithAuthorization struct field-for-field",
    );
    assert.deepEqual(typedData.types.EIP712Domain, [
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
    ]);
    assert.equal(typedData.message.from, "0xFrom");
    assert.equal(typedData.message.to, "0xTo");
    assert.equal(typedData.message.value, "1000000");
    assert.equal(typedData.message.validAfter, "0");
    assert.ok(Number(typedData.message.validBefore) > Math.floor(Date.now() / 1000));
    assert.equal(typedData.message.nonce, "0x" + "1".repeat(64));

    assert.equal(payload.signature, "0x2d6a7588d6acca50", "adds a missing 0x prefix rather than trusting Circle always includes one");
    assert.equal(payload.authorization.from, "0xFrom");
    assert.equal(payload.authorization.value, "1000000");
  });

  test("the nonce is never generated internally - retrying with the same caller-supplied nonce signs the same authorization twice, not two independently payable ones", async () => {
    globalThis.fetch = (async () => jsonResponse({ data: { signature: "0xsig" } })) as typeof fetch;
    const client = new CircleApiClient({ apiKey: "test-key" });
    const params = {
      client,
      walletId: "wal_1",
      entitySecretHex: "a".repeat(64),
      entityPublicKeyPem: publicKey,
      chainId: 11155111,
      tokenAddress: "0xToken",
      tokenName: "USDC",
      tokenVersion: "2",
      from: "0xFrom",
      to: "0xTo",
      atomicAmount: "1",
      maxTimeoutSeconds: 60,
      nonce: "0x" + "7".repeat(64),
    };

    const first = await signTransferAuthorization(params);
    const second = await signTransferAuthorization(params);

    assert.equal(first.authorization.nonce, params.nonce);
    assert.equal(second.authorization.nonce, params.nonce);
  });
});

describe("isAuthorizationUsed", () => {
  test("returns false for a zero eth_call result", async () => {
    globalThis.fetch = (async () => jsonResponse({ jsonrpc: "2.0", id: 1, result: "0x" + "0".repeat(64) })) as typeof fetch;
    const used = await isAuthorizationUsed("https://rpc.test", "0xToken", "0xAuthorizer", "0x" + "1".repeat(64));
    assert.equal(used, false);
  });

  test("returns true for a non-zero eth_call result", async () => {
    globalThis.fetch = (async () => jsonResponse({ jsonrpc: "2.0", id: 1, result: "0x" + "0".repeat(63) + "1" })) as typeof fetch;
    const used = await isAuthorizationUsed("https://rpc.test", "0xToken", "0xAuthorizer", "0x" + "1".repeat(64));
    assert.equal(used, true);
  });

  test("encodes the real authorizationState(address,bytes32) selector, confirmed against 4byte.directory", async () => {
    let capturedData = "";
    globalThis.fetch = (async (_url, init) => {
      capturedData = (JSON.parse((init as RequestInit).body as string) as { params: [{ data: string }, string] }).params[0].data;
      return jsonResponse({ jsonrpc: "2.0", id: 1, result: "0x" + "0".repeat(64) });
    }) as typeof fetch;

    await isAuthorizationUsed("https://rpc.test", "0xToken", "0xAAAAaaaaAAAAaAAAAAAAAAAAAAAAAaAaaAaaaaAA", "0x" + "b".repeat(64));

    assert.ok(capturedData.startsWith("0xe94a0102"));
    assert.equal(capturedData.length, 10 + 64 + 64);
  });

  test("throws on an RPC error rather than silently reporting unused", async () => {
    globalThis.fetch = (async () => jsonResponse({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "execution reverted" } })) as typeof fetch;
    await assert.rejects(() => isAuthorizationUsed("https://rpc.test", "0xToken", "0xAuthorizer", "0x" + "1".repeat(64)));
  });
});
