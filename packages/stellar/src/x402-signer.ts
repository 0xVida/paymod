import { Address, BASE_FEE, Keypair, Operation, TransactionBuilder, hash, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { Api, type Server, assembleTransaction } from "@stellar/stellar-sdk/rpc";
import type { ExecutorSigner, RelayerSigner } from "./signer.js";

/**
 * builds and signs a Soroban authorization entry naming the Treasury
 * Contract as `sorobanCredentialsAddress` for a direct `token.transfer(from:
 * treasury, to: destination, amount)`, the call shape x402's exact-scheme
 * facilitator on Stellar requires the payer to sign. See ADR 0008 and
 * `TreasuryContract`'s `__check_auth`.
 *
 * Cannot go through `@stellar/stellar-sdk`'s `authorizeEntry`/
 * `AssembledTransaction.signAuthEntries`: both hard-code the standard
 * `{public_key, signature}` shape used by ordinary account-signature
 * custom accounts, not our contract's `ExecutorSignature{payment_id,
 * signature}` struct. This mirrors `authorizeEntry`'s own preimage
 * construction (verified against `@stellar/stellar-base`'s source) but
 * signs with the executor's raw key and encodes to match
 * `__check_auth`'s actual `type Signature`.
 *
 * `ExecutorSigner.signAuthEntry` already does exactly this: hash the
 * base64 XDR, sign with the executor's key, return the raw signature.
 * Reused here rather than asking every `ExecutorSigner` implementation
 * (env-based today, KMS-backed in Slice 6) to also expose raw signing.
 */
export async function buildX402TransferAuthorizationEntry(params: {
  server: Server;
  networkPassphrase: string;
  treasuryContractId: string;
  tokenContractId: string;
  destination: string;
  atomicAmount: bigint;
  paymentId: Buffer;
  executor: ExecutorSigner;
  /** from the merchant's PaymentRequirements: the facilitator rejects an expiration set any further out than this. */
  maxTimeoutSeconds: number;
}): Promise<xdr.SorobanAuthorizationEntry> {
  if (params.paymentId.length !== 32) {
    throw new Error(`paymentId must be 32 bytes, got ${params.paymentId.length}`);
  }

  const invocation = buildTransferInvocation(params);
  const expirationLedger = await resolveExpirationLedger(params.server, params.maxTimeoutSeconds);
  const nonce = randomNonce();

  const networkId = hash(Buffer.from(params.networkPassphrase));
  const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId,
      nonce,
      invocation,
      signatureExpirationLedger: expirationLedger,
    }),
  );

  const { signedAuthEntry } = await params.executor.signAuthEntry(preimage.toXDR("base64"));
  const signature = Buffer.from(signedAuthEntry, "base64");

  const credentials = new xdr.SorobanAddressCredentials({
    address: new Address(params.treasuryContractId).toScAddress(),
    nonce,
    signatureExpirationLedger: expirationLedger,
    signature: encodeExecutorSignature(params.paymentId, signature),
  });

  return new xdr.SorobanAuthorizationEntry({
    rootInvocation: invocation,
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(credentials),
  });
}

/**
 * builds the transaction for the `PAYMENT-SIGNATURE` header: the
 * `__check_auth`-authorized transfer, sourced from Paymod's relayer
 * account (for a valid sequence number and resource fee) but left
 * *unsigned* at the envelope level. Confirmed against the live Built on
 * Stellar facilitator (`/verify`), which rejects a pre-signed envelope
 * (`invalid_exact_stellar_payload_has_envelope_signatures`) and supplies
 * its own sponsor signature instead. The relayer account only produces a
 * structurally valid, simulatable shell; its key never signs anything.
 * Authority for the transfer comes entirely from the treasury's own
 * `__check_auth`-verified entry, independent of whichever account the
 * facilitator ultimately submits under.
 */
export async function buildSignedX402Transaction(params: {
  server: Server;
  networkPassphrase: string;
  treasuryContractId: string;
  tokenContractId: string;
  destination: string;
  atomicAmount: bigint;
  paymentId: Buffer;
  executor: ExecutorSigner;
  relayer: RelayerSigner;
  maxTimeoutSeconds: number;
}): Promise<string> {
  const entry = await buildX402TransferAuthorizationEntry(params);
  const invokeArgs = entry.rootInvocation().function().contractFn();
  const op = Operation.invokeHostFunction({
    func: xdr.HostFunction.hostFunctionTypeInvokeContract(invokeArgs),
    auth: [entry],
  });

  const relayerAccount = await params.server.getAccount(params.relayer.publicKey());
  const tx = new TransactionBuilder(relayerAccount, {
    fee: BASE_FEE,
    networkPassphrase: params.networkPassphrase,
  })
    .addOperation(op)
    .setTimeout(30)
    .build();

  const simulation = await params.server.simulateTransaction(tx);
  if (Api.isSimulationError(simulation)) {
    throw new Error(`x402 transaction simulation failed: ${simulation.error}`);
  }
  const assembled = assembleTransaction(tx, simulation).build();
  return assembled.toXDR();
}

function buildTransferInvocation(params: {
  treasuryContractId: string;
  tokenContractId: string;
  destination: string;
  atomicAmount: bigint;
}): xdr.SorobanAuthorizedInvocation {
  const args = [
    new Address(params.treasuryContractId).toScVal(),
    new Address(params.destination).toScVal(),
    nativeToScVal(params.atomicAmount, { type: "i128" }),
  ];
  const op = Operation.invokeContractFunction({
    contract: params.tokenContractId,
    function: "transfer",
    args,
  });
  const invokeArgs = op.body().invokeHostFunctionOp().hostFunction().invokeContract();
  return new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(invokeArgs),
    subInvocations: [],
  });
}

/** ~5s per ledger on Stellar; a fixed constant here would drift from the network's actual pace. */
const ESTIMATED_LEDGER_SECONDS = 5;

async function resolveExpirationLedger(server: Server, maxTimeoutSeconds: number): Promise<number> {
  const latest = await server.getLatestLedger();
  const validityLedgers = Math.ceil(maxTimeoutSeconds / ESTIMATED_LEDGER_SECONDS);
  return latest.sequence + validityLedgers;
}

/** matches `authorizeInvocation`'s own nonce convention: random, not secret. */
function randomNonce(): xdr.Int64 {
  const bytes = Keypair.random().rawPublicKey();
  const value = bytes.subarray(0, 8).reduce((accum, b) => (accum << 8) | b, 0);
  return new xdr.Int64(value);
}

/**
 * Encodes `ExecutorSignature{payment_id: BytesN<32>, signature: BytesN<64>}`
 * exactly as soroban-sdk's `#[contracttype]` derive encodes a named-field
 * struct: an `ScMap` keyed by field name as symbols, sorted alphabetically.
 * `payment_id` sorts before `signature`, matching the field order below.
 */
function encodeExecutorSignature(paymentId: Buffer, signature: Buffer): xdr.ScVal {
  return nativeToScVal(
    { payment_id: paymentId, signature },
    { type: { payment_id: ["symbol", null], signature: ["symbol", null] } },
  );
}
