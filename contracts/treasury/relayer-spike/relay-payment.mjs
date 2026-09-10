import {
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";
import { Api, Server, assembleTransaction } from "@stellar/stellar-sdk/rpc";
import { AssembledTransaction, basicNodeSigner } from "@stellar/stellar-sdk/contract";
import { readFile } from "node:fs/promises";

const RPC_URL = "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = Networks.TESTNET;
const required = [
  "TREASURY_CONTRACT_ID",
  "RECIPIENT",
  "AMOUNT",
  "PAYMENT_ID_HEX",
];

for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing ${name}`);
}

async function readSecret(name) {
  if (process.env[name]) return process.env[name];
  const file = process.env[`${name}_FILE`];
  if (file) return (await readFile(file, "utf8")).trim();
  throw new Error(`Missing ${name} or ${name}_FILE`);
}

const executor = Keypair.fromSecret(await readSecret("PAYMOD_EXECUTOR_SECRET"));
const relayer = Keypair.fromSecret(await readSecret("PAYMOD_RELAYER_SECRET"));
const contractId = process.env.TREASURY_CONTRACT_ID;
const recipient = process.env.RECIPIENT;
const amount = BigInt(process.env.AMOUNT);
const paymentId = process.env.PAYMENT_ID_HEX;

if (!/^[0-9a-fA-F]{64}$/.test(paymentId)) {
  throw new Error("PAYMENT_ID_HEX must contain exactly 32 bytes of hex");
}
if (amount <= 0n) throw new Error("AMOUNT must be positive");

const server = new Server(RPC_URL);

async function buildExecutorAuthorizedXdr() {
  // This transaction is intentionally built with a throwaway source. The
  // executor signs only the simulated auth entry, never this envelope.
  const tx = await AssembledTransaction.build({
    contractId,
    method: "execute_payment",
    args: [
      nativeToScVal(Buffer.from(paymentId, "hex"), { type: "bytes" }),
      nativeToScVal(recipient, { type: "address" }),
      nativeToScVal(amount, { type: "i128" }),
    ],
    networkPassphrase: NETWORK_PASSPHRASE,
    rpcUrl: RPC_URL,
    parseResultXdr: (result) => result,
  });

  if (Api.isSimulationError(tx.simulation)) {
    throw new Error(`Recording simulation failed: ${tx.simulation.error}`);
  }
  if (!tx.needsNonInvokerSigningBy().includes(executor.publicKey())) {
    throw new Error("Executor was not requested to authorize the payment");
  }

  const executorSigner = basicNodeSigner(executor, NETWORK_PASSPHRASE);
  await tx.signAuthEntries({
    address: executor.publicKey(),
    signAuthEntry: executorSigner.signAuthEntry,
    expiration: tx.simulation.latestLedger + 24,
  });

  // Enforcing-mode simulation verifies the detached executor authorization.
  await tx.simulate();
  if (Api.isSimulationError(tx.simulation)) {
    throw new Error(`Executor authorization validation failed: ${tx.simulation.error}`);
  }
  if (tx.needsNonInvokerSigningBy().length !== 0) {
    throw new Error("A required authorization entry remains unsigned");
  }
  return tx.built.toXDR();
}

async function relay(executorAuthorizedXdr) {
  const executorTx = new Transaction(executorAuthorizedXdr, NETWORK_PASSPHRASE);
  const envelope = xdr.TransactionEnvelope.fromXDR(executorAuthorizedXdr, "base64");
  const sorobanData = envelope.v1()?.tx()?.ext()?.sorobanData();
  if (!sorobanData) throw new Error("Missing Soroban transaction data");

  const invoke = executorTx.operations[0];
  if (executorTx.operations.length !== 1 || !invoke.func || !Array.isArray(invoke.auth)) {
    throw new Error("Expected exactly one executor-authorized contract invocation");
  }

  // Paymod must constrain the envelope it is willing to relay. Do not accept
  // arbitrary caller-provided XDR in production.
  if (executorTx.source === relayer.publicKey()) {
    throw new Error("Authorization transaction must not use the relayer as source");
  }

  const relayerAccount = await server.getAccount(relayer.publicKey());
  const relayedTx = new TransactionBuilder(relayerAccount, {
    fee: executorTx.fee || BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
    sorobanData,
  })
    .addOperation(
      Operation.invokeHostFunction({
        func: invoke.func,
        auth: invoke.auth,
        source: invoke.source,
      }),
    )
    .setTimeout(30)
    .build();

  // This enforcing-mode simulation refreshes the relayer’s resource fee and
  // verifies the executor's signed auth entry before Paymod pays network fees.
  const simulation = await server.simulateTransaction(relayedTx);
  if (Api.isSimulationError(simulation)) {
    throw new Error(`Relayer validation failed: ${simulation.error}`);
  }

  const assembled = assembleTransaction(relayedTx, simulation).build();
  assembled.sign(relayer);
  const submitted = await server.sendTransaction(assembled);
  const final = await server.pollTransaction(submitted.hash);
  if (final.status !== "SUCCESS") {
    throw new Error(`Relayed transaction did not succeed: ${final.status}`);
  }
  return submitted.hash;
}

const authorizationXdr = await buildExecutorAuthorizedXdr();
const hash = await relay(authorizationXdr);
console.log(`Relayed payment submitted: ${hash}`);
