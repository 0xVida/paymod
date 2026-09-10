import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { Keypair, Networks, Transaction } from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";
import { basicNodeSigner } from "@stellar/stellar-sdk/contract";
import { readTokenBalance } from "./balance.js";
import { isPaymentExecuted, readTreasuryState } from "./treasury-state.js";
import { buildSignedX402Transaction } from "./x402-signer.js";
import type { ExecutorSigner, RelayerSigner } from "./signer.js";

/**
 * Gated on STELLAR_LIVE=1: moves real Testnet USDC through the vault's
 * `__check_auth` path, not `execute_payment`. Proves the on-chain
 * mechanism ADR 0008 describes works against the real network, not just
 * the Rust contract's native test harness (`contracts/treasury/src/test.rs`
 * exercises the same logic directly, bypassing the host's real auth
 * dispatch).
 *
 *   STELLAR_CONFIG_DIR=/path/to/identities \
 *   TREASURY_CONTRACT_ID=C... \
 *   STELLAR_LIVE=1 npm --workspace @paymod/stellar run test:live
 *
 * The contract must be a v2 treasury, initialized with an
 * `executor_public_key`, per `tools/paymod-testnet deploy`.
 *
 * This test submits the transaction `buildSignedX402Transaction` produces
 * itself, standing in for a facilitator: proving the envelope handed to a
 * real facilitator via `PAYMENT-SIGNATURE` is independently valid and
 * submittable, not merely well-formed.
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
  private readonly kp: Keypair;
  readonly signAuthEntry: ExecutorSigner["signAuthEntry"];

  constructor(secret: string) {
    this.kp = Keypair.fromSecret(secret);
    this.signAuthEntry = basicNodeSigner(this.kp, NETWORK_PASSPHRASE).signAuthEntry;
  }

  publicKey(): string {
    return this.kp.publicKey();
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

test("live: the vault signs a direct token transfer via __check_auth, not execute_payment", { skip: !enabled }, async () => {
  const configDir = process.env.STELLAR_CONFIG_DIR;
  const contractId = process.env.TREASURY_CONTRACT_ID;
  assert.ok(configDir, "STELLAR_CONFIG_DIR is required for the live test");
  assert.ok(contractId, "TREASURY_CONTRACT_ID is required for the live test");

  const executor = new TestExecutorSigner(stellarKeysSecret(configDir!, "executor"));
  const relayer = new TestRelayerSigner(stellarKeysSecret(configDir!, "relayer"));
  const ownerAddress = stellarKeysAddress(configDir!, "owner");
  const server = new Server(RPC_URL);

  const preState = await readTreasuryState(server, contractId!);
  assert.equal(preState.paused, false, "the treasury must not be paused to run this test");

  const beforeBalance = await readTokenBalance(server, preState.token, ownerAddress, NETWORK_PASSPHRASE);
  const beforeSpent = BigInt(preState.spentInPeriodAtomic);

  const amountAtomic = 1n; // smallest possible unit: 0.0000001 USDC
  const paymentId = Buffer.alloc(32);
  paymentId.writeUInt32BE(Date.now() % 0xffffffff, 0); // unique enough per test run

  const transactionXdr = await buildSignedX402Transaction({
    server,
    networkPassphrase: NETWORK_PASSPHRASE,
    treasuryContractId: contractId!,
    tokenContractId: preState.token,
    destination: ownerAddress,
    atomicAmount: amountAtomic,
    paymentId,
    executor,
    relayer,
    maxTimeoutSeconds: 60,
  });

  // buildSignedX402Transaction leaves the envelope unsigned (the real
  // Built on Stellar facilitator supplies its own sponsor signature and
  // rejects a pre-signed one). Standing in for that facilitator, this
  // test signs and submits with the relayer itself.
  const assembled = new Transaction(transactionXdr, NETWORK_PASSPHRASE);
  assembled.sign(relayer.keypair());
  const submitted = await server.sendTransaction(assembled);
  assert.equal(submitted.status, "PENDING", `submission failed: ${JSON.stringify(submitted)}`);

  const final = await server.pollTransaction(submitted.hash);
  assert.equal(final.status, "SUCCESS", `transaction did not confirm: ${JSON.stringify(final)}`);

  const afterBalance = await readTokenBalance(server, preState.token, ownerAddress, NETWORK_PASSPHRASE);
  assert.equal(
    (afterBalance - beforeBalance).toString(),
    amountAtomic.toString(),
    "recipient balance must rise by exactly the atomic amount",
  );

  const postState = await readTreasuryState(server, contractId!);
  const executed = await isPaymentExecuted(server, contractId!, NETWORK_PASSPHRASE, paymentId);
  assert.ok(executed, "the shared Executed(payment_id) storage must record this x402 payment, same as execute_payment would");
  assert.equal(
    BigInt(postState.spentInPeriodAtomic) - beforeSpent,
    amountAtomic,
    "spent_in_period must advance by the same amount: proves __check_auth drew from execute_payment's shared budget counter",
  );
});
