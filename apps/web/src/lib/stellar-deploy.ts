import { Address, StrKey, nativeToScVal } from "@stellar/stellar-sdk";
import { AssembledTransaction, Client } from "@stellar/stellar-sdk/contract";
import * as freighter from "@stellar/freighter-api";

export type DeployConfig = {
  networkPassphrase: string;
  rpcUrl: string;
  executorPublicKey: string;
  usdcContractId: string;
  treasuryWasmHash: string;
};

export type DeployParams = {
  maxPerPaymentAtomic: string;
  maxPerPeriodAtomic: string;
  periodSeconds: number;
};

export type DeployStep = "connecting" | "deploying" | "initializing" | "registering" | "done";

/**
 * browser-side counterpart to `tools/paymod-testnet.mjs`'s `deploy()`, same
 * create-then-initialize shape but signed by the owner's Freighter wallet
 * instead of a CLI keypair - no Paymod key is involved, per ADR 0001.
 * two separate transactions since `initialize`'s target contract address
 * only exists once the create transaction has confirmed.
 */
export async function deployTreasury(
  config: DeployConfig,
  params: DeployParams,
  onStep: (step: DeployStep) => void,
): Promise<{ contractId: string; ownerAddress: string }> {
  onStep("connecting");
  const access = await freighter.requestAccess();
  if (access.error) throw new Error(access.error.message ?? "Freighter connection was refused");
  const ownerAddress = access.address;

  onStep("deploying");
  const deployTx = await Client.deploy(null, {
    wasmHash: config.treasuryWasmHash,
    address: ownerAddress,
    networkPassphrase: config.networkPassphrase,
    rpcUrl: config.rpcUrl,
    publicKey: ownerAddress,
    signTransaction: freighter.signTransaction,
  });
  const deployed = await deployTx.signAndSend();
  const contractId = deployed.result.options.contractId;

  onStep("initializing");
  const executorPublicKeyHex = StrKey.decodeEd25519PublicKey(config.executorPublicKey);
  const initTx = await AssembledTransaction.build({
    contractId,
    method: "initialize",
    args: [
      new Address(ownerAddress).toScVal(),
      new Address(config.executorPublicKey).toScVal(),
      nativeToScVal(executorPublicKeyHex, { type: "bytes" }),
      new Address(config.usdcContractId).toScVal(),
      nativeToScVal(BigInt(params.maxPerPaymentAtomic), { type: "i128" }),
      nativeToScVal(BigInt(params.maxPerPeriodAtomic), { type: "i128" }),
      nativeToScVal(BigInt(params.periodSeconds), { type: "u64" }),
      // 0 = no expiry (the contract's default, unchanged behavior). setting
      // a real expiry is a later product decision, not part of this deploy
      // flow yet - see contracts/treasury's `set_authority_expiry`.
      nativeToScVal(0n, { type: "u64" }),
    ],
    networkPassphrase: config.networkPassphrase,
    rpcUrl: config.rpcUrl,
    publicKey: ownerAddress,
    signTransaction: freighter.signTransaction,
    parseResultXdr: (result) => result,
  });
  await initTx.signAndSend();

  onStep("done");
  return { contractId, ownerAddress };
}

export type FundStep = "connecting" | "sending" | "done";
export type LimitsStep = "connecting" | "updating" | "done";

/**
 * plain SEP-41 `transfer`, Freighter-signed. `owner.require_auth()` is
 * satisfied by the classic tx signature alone since owner is both signer
 * and source, so no separate auth-entry step is needed, same as
 * `initialize` above. `Address` accepts a `G...` account or `C...`
 * contract, covering treasury funding and plain wallet sends alike.
 */
export async function transferUsdc(
  config: Pick<DeployConfig, "networkPassphrase" | "rpcUrl" | "usdcContractId">,
  params: { destination: string; amountAtomic: string },
  onStep: (step: FundStep) => void,
): Promise<{ ownerAddress: string }> {
  onStep("connecting");
  const access = await freighter.requestAccess();
  if (access.error) throw new Error(access.error.message ?? "Freighter connection was refused");
  const ownerAddress = access.address;

  onStep("sending");
  const tx = await AssembledTransaction.build({
    contractId: config.usdcContractId,
    method: "transfer",
    args: [
      new Address(ownerAddress).toScVal(),
      new Address(params.destination).toScVal(),
      nativeToScVal(BigInt(params.amountAtomic), { type: "i128" }),
    ],
    networkPassphrase: config.networkPassphrase,
    rpcUrl: config.rpcUrl,
    publicKey: ownerAddress,
    signTransaction: freighter.signTransaction,
    parseResultXdr: (result) => result,
  });
  await tx.signAndSend();

  onStep("done");
  return { ownerAddress };
}

export async function setTreasuryLimits(
  config: Pick<DeployConfig, "networkPassphrase" | "rpcUrl">,
  params: {
    contractId: string;
    maxPerPaymentAtomic: string;
    maxPerPeriodAtomic: string;
    periodSeconds: number;
  },
  onStep: (step: LimitsStep) => void,
): Promise<void> {
  onStep("connecting");
  const access = await freighter.requestAccess();
  if (access.error) throw new Error(access.error.message ?? "Freighter connection was refused");

  onStep("updating");
  const tx = await AssembledTransaction.build({
    contractId: params.contractId,
    method: "set_limits",
    args: [
      nativeToScVal(BigInt(params.maxPerPaymentAtomic), { type: "i128" }),
      nativeToScVal(BigInt(params.maxPerPeriodAtomic), { type: "i128" }),
      nativeToScVal(BigInt(params.periodSeconds), { type: "u64" }),
    ],
    networkPassphrase: config.networkPassphrase,
    rpcUrl: config.rpcUrl,
    publicKey: access.address,
    signTransaction: freighter.signTransaction,
    parseResultXdr: (result) => result,
  });
  await tx.signAndSend();
  onStep("done");
}
