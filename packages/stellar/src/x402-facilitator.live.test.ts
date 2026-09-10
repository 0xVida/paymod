import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { Keypair, Networks } from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";
import { basicNodeSigner } from "@stellar/stellar-sdk/contract";
import { isPaymentExecuted, readTreasuryState } from "./treasury-state.js";
import { buildSignedX402Transaction } from "./x402-signer.js";
import type { ExecutorSigner, RelayerSigner } from "./signer.js";

/**
 * Gated on STELLAR_LIVE=1 and X402_FACILITATOR_API_KEY. The strongest
 * proof available that ADR 0008's design works: calls the real "Built on
 * Stellar" facilitator's production `/verify` and `/settle` endpoints
 * (not a mock) with a payload from `buildSignedX402Transaction`, and
 * checks that a third party we don't control understands our custom
 * `__check_auth`/`ExecutorSignature` encoding and settles a real payment.
 *
 *   STELLAR_CONFIG_DIR=/path/to/identities \
 *   TREASURY_CONTRACT_ID=C... \
 *   X402_FACILITATOR_API_KEY=... \
 *   STELLAR_LIVE=1 npm --workspace @paymod/stellar run test:live
 *
 * Two real facilitator requirements this test's inputs must satisfy,
 * discovered by running against the live service rather than the spec:
 *   - The envelope must be UNSIGNED: the facilitator supplies its own
 *     sponsor/source signature and rejects a pre-signed one
 *     (`invalid_exact_stellar_payload_has_envelope_signatures`).
 *   - The auth entry's expiration must not exceed
 *     `currentLedger + ceil(maxTimeoutSeconds / ~5s)`; a looser
 *     expiration is rejected
 *     (`invalid_exact_stellar_payload_auth_expiration_too_far`).
 * `buildSignedX402Transaction` already encodes both; this test caught
 * them first.
 */

const RPC_URL = "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = Networks.TESTNET;
const FACILITATOR_BASE_URL = "https://channels.openzeppelin.com/x402/testnet";
const MAX_TIMEOUT_SECONDS = 60;

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

type FacilitatorResponse = {
  isValid?: boolean;
  invalidReason?: string;
  success?: boolean;
  errorReason?: string;
  transaction?: string;
  payer?: string;
};

async function callFacilitator(path: string, apiKey: string, body: unknown): Promise<FacilitatorResponse> {
  const response = await fetch(`${FACILITATOR_BASE_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  return response.json() as Promise<FacilitatorResponse>;
}

const enabled = process.env.STELLAR_LIVE === "1" && !!process.env.X402_FACILITATOR_API_KEY;

test("live: the real Built on Stellar facilitator verifies and settles a Paymod-signed x402 payment", { skip: !enabled }, async () => {
  const configDir = process.env.STELLAR_CONFIG_DIR;
  const contractId = process.env.TREASURY_CONTRACT_ID;
  const apiKey = process.env.X402_FACILITATOR_API_KEY;
  assert.ok(configDir, "STELLAR_CONFIG_DIR is required for the live test");
  assert.ok(contractId, "TREASURY_CONTRACT_ID is required for the live test");
  assert.ok(apiKey, "X402_FACILITATOR_API_KEY is required for the live test");

  const executor = new TestExecutorSigner(stellarKeysSecret(configDir!, "executor"));
  const relayer = new TestRelayerSigner(stellarKeysSecret(configDir!, "relayer"));
  const ownerAddress = stellarKeysAddress(configDir!, "owner");
  const server = new Server(RPC_URL);

  const preState = await readTreasuryState(server, contractId!);
  const beforeSpent = BigInt(preState.spentInPeriodAtomic);

  const amountAtomic = 1n;
  const paymentId = Buffer.alloc(32);
  paymentId.writeUInt32BE(Date.now() % 0xffffffff, 0);

  const requirement = {
    scheme: "exact",
    network: "stellar:testnet",
    amount: amountAtomic.toString(),
    asset: preState.token,
    payTo: ownerAddress,
    maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
    extra: { areFeesSponsored: true },
  };

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
    maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
  });

  const facilitatorBody = {
    x402Version: 2,
    paymentPayload: { x402Version: 2, accepted: requirement, payload: { transaction: transactionXdr } },
    paymentRequirements: requirement,
  };

  const verifyResult = await callFacilitator("/verify", apiKey!, facilitatorBody);
  assert.equal(verifyResult.isValid, true, `facilitator rejected the payload: ${verifyResult.invalidReason}`);
  assert.equal(verifyResult.payer, contractId, "the facilitator must identify the treasury contract as payer");

  const settleResult = await callFacilitator("/settle", apiKey!, facilitatorBody);
  assert.equal(settleResult.success, true, `facilitator settlement failed: ${settleResult.errorReason}`);
  assert.ok(settleResult.transaction, "a successful settlement must return a transaction hash");

  const postState = await readTreasuryState(server, contractId!);
  assert.equal(
    BigInt(postState.spentInPeriodAtomic) - beforeSpent,
    amountAtomic,
    "spent_in_period must advance by the settled amount: the facilitator-submitted payment shares execute_payment's budget counter",
  );
  const executed = await isPaymentExecuted(server, contractId!, NETWORK_PASSPHRASE, paymentId);
  assert.ok(executed, "the payment id the facilitator settled must land in the shared Executed() replay-protection storage");
});
