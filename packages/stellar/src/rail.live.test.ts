import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { Keypair, Networks } from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";
import { basicNodeSigner } from "@stellar/stellar-sdk/contract";
import { newId } from "@paymod/shared";
import { isSafeToRelease, isTerminal, type SettlementIntent } from "@paymod/payments";
import { StellarPaymentRail } from "./rail.js";
import { isPaymentExecuted, readTreasuryState } from "./treasury-state.js";
import { readTokenBalance } from "./balance.js";
import { derivePaymentIdHex } from "./payment-id.js";
import { PaymentAlreadyExecutedError } from "./contract-errors.js";
import type { ExecutorSigner, RelayerSigner } from "./signer.js";

/**
 * Gated on STELLAR_LIVE=1: moves real Testnet USDC. Not part of the
 * default `npm test` run; excluded from CI unless explicitly opted in.
 *
 *   STELLAR_CONFIG_DIR=/path/to/identities \
 *   TREASURY_CONTRACT_ID=C... \
 *   STELLAR_LIVE=1 npm --workspace @paymod/stellar run test:live
 *
 * Uses the three-role identity set from `paymod-testnet init`
 * (owner/executor/relayer) or the equivalent spike identities. The
 * contract's on-chain executor must be the `paymod-executor` identity's
 * key; if it was rotated (per ADR 0004's revocation step, as the
 * historical spike treasury was), point TREASURY_CONTRACT_ID at a
 * treasury with a live executor, or redeploy with `paymod-testnet
 * deploy && paymod-testnet fund`.
 */

const RPC_URL = "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = Networks.TESTNET;

function stellarKeysAddress(configDir: string, name: string): string {
  return execSync(`stellar --config-dir "${configDir}" keys address ${name}`, { encoding: "utf8" }).trim();
}

function stellarKeysSecret(configDir: string, name: string): string {
  return execSync(`stellar --config-dir "${configDir}" keys secret ${name}`, { encoding: "utf8" }).trim();
}

class TestExecutorSigner implements ExecutorSigner {
  private readonly keypair: Keypair;
  readonly signAuthEntry: ExecutorSigner["signAuthEntry"];

  constructor(secret: string) {
    this.keypair = Keypair.fromSecret(secret);
    this.signAuthEntry = basicNodeSigner(this.keypair, NETWORK_PASSPHRASE).signAuthEntry;
  }

  publicKey(): string {
    return this.keypair.publicKey();
  }
}

class TestRelayerSigner implements RelayerSigner {
  private readonly kp: Keypair;
  constructor(secret: string) {
    this.kp = Keypair.fromSecret(secret);
  }
  publicKey(): string {
    return this.kp.publicKey();
  }
  keypair(): Keypair {
    return this.kp;
  }
}

const enabled = process.env.STELLAR_LIVE === "1";

test("live: a governed transfer moves real Testnet USDC through prepare -> submit -> confirm", { skip: !enabled }, async () => {
  const configDir = process.env.STELLAR_CONFIG_DIR;
  const contractId = process.env.TREASURY_CONTRACT_ID;
  assert.ok(configDir, "STELLAR_CONFIG_DIR is required for the live test");
  assert.ok(contractId, "TREASURY_CONTRACT_ID is required for the live test");

  const executorSecret = stellarKeysSecret(configDir!, "executor");
  const relayerSecret = stellarKeysSecret(configDir!, "relayer");
  const ownerAddress = stellarKeysAddress(configDir!, "owner");

  const executor = new TestExecutorSigner(executorSecret);
  const relayer = new TestRelayerSigner(relayerSecret);
  const server = new Server(RPC_URL);
  const rail = new StellarPaymentRail(server, executor, relayer, NETWORK_PASSPHRASE);

  const preState = await readTreasuryState(server, contractId!);
  assert.equal(preState.executor, executor.publicKey(), "the on-chain executor must be this test's executor key");
  assert.equal(preState.paused, false, "the treasury must not be paused to run this test");

  const beforeBalance = await readTokenBalance(server, preState.token, ownerAddress, NETWORK_PASSPHRASE);

  const intentId = newId("intent");
  const paymentId = derivePaymentIdHex(intentId);
  const amountAtomic = "1"; // smallest possible unit: 0.0000001 USDC

  const intent: SettlementIntent = {
    intentId,
    requestId: newId("request"),
    accountId: newId("account"),
    walletId: newId("wallet"),
    externalWalletId: contractId!,
    networkId: "stellar:testnet",
    assetCode: "USDC",
    atomicAmount: amountAtomic,
    destination: ownerAddress,
    paymentId,
    expiresAt: new Date(Date.now() + 5 * 60_000),
    metadata: {},
  };

  const prepared = await rail.prepare(intent);
  const submission = await rail.submit(prepared);
  const outcome = await rail.confirm(submission);

  assert.equal(outcome.status, "CONFIRMED");
  assert.equal(isTerminal(outcome), true);
  assert.equal(isSafeToRelease(outcome), false);
  if (outcome.status === "CONFIRMED") {
    assert.equal(outcome.actualAtomic, amountAtomic);
    assert.equal(outcome.alreadyExecuted, false);
  }

  const afterBalance = await readTokenBalance(server, preState.token, ownerAddress, NETWORK_PASSPHRASE);
  assert.equal((afterBalance - beforeBalance).toString(), amountAtomic, "recipient balance must rise by exactly the atomic amount");

  const executed = await isPaymentExecuted(server, contractId!, NETWORK_PASSPHRASE, Buffer.from(paymentId, "hex"));
  assert.ok(executed, "the contract must record this payment id as executed");
});

test("live: replaying the same intent id is safe: retrying maps to the same paymentId", { skip: !enabled }, async () => {
  const configDir = process.env.STELLAR_CONFIG_DIR;
  const contractId = process.env.TREASURY_CONTRACT_ID;
  assert.ok(configDir);
  assert.ok(contractId);

  const executor = new TestExecutorSigner(stellarKeysSecret(configDir!, "executor"));
  const relayer = new TestRelayerSigner(stellarKeysSecret(configDir!, "relayer"));
  const ownerAddress = stellarKeysAddress(configDir!, "owner");
  const server = new Server(RPC_URL);
  const rail = new StellarPaymentRail(server, executor, relayer, NETWORK_PASSPHRASE);

  // same intentId as the previous test, deliberately, to exercise a retry of
  // an already-settled payment: the exact scenario a crashed-worker restart
  // produces.
  const intentId = "int_LIVE_TEST_FIXED_RETRY_CASE";
  const paymentId = derivePaymentIdHex(intentId);

  const intent: SettlementIntent = {
    intentId,
    requestId: newId("request"),
    accountId: newId("account"),
    walletId: newId("wallet"),
    externalWalletId: contractId!,
    networkId: "stellar:testnet",
    assetCode: "USDC",
    atomicAmount: "1",
    destination: ownerAddress,
    paymentId,
    expiresAt: new Date(Date.now() + 5 * 60_000),
    metadata: {},
  };

  const alreadyExecuted = await isPaymentExecuted(server, contractId!, NETWORK_PASSPHRASE, Buffer.from(paymentId, "hex"));

  if (!alreadyExecuted) {
    // first run against this fixed intentId: pay once to establish the case.
    const prepared = await rail.prepare(intent);
    const submission = await rail.submit(prepared);
    const outcome = await rail.confirm(submission);
    assert.equal(outcome.status, "CONFIRMED");
  }

  // retry: prepare() must now surface PaymentAlreadyExecutedError rather than
  // an opaque simulation failure: this is the entire point of the test.
  await assert.rejects(() => rail.prepare(intent), (err: unknown) => {
    assert.ok(err instanceof PaymentAlreadyExecutedError);
    assert.equal(err.paymentId, paymentId);
    return true;
  });
});
