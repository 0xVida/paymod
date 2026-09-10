import { readFile } from "node:fs/promises";
import { Keypair } from "@stellar/stellar-sdk";
import { basicNodeSigner } from "@stellar/stellar-sdk/contract";
import type { SignAuthEntry } from "@stellar/stellar-sdk/contract";

/**
 * the executor's signing authority, behind an interface so a KMS/HSM-backed
 * implementation (Slice 6) can replace `EnvExecutorSigner` without touching
 * `StellarPaymentRail`. Keep this secret out of every process that doesn't
 * need it: ADR 0001 and ADR 0007 both hinge on it staying narrowly scoped.
 *
 * `signAuthEntry` matches the SDK's own shape exactly, so an
 * `ExecutorSigner` can be handed straight to
 * `AssembledTransaction.signAuthEntries` without an adapter.
 */
export interface ExecutorSigner {
  publicKey(): string;
  /**
   * Signs exactly one Soroban authorization entry. Never asked to sign a full
   * transaction envelope: the executor's authority is scoped to the payment
   * it is authorizing, not to submission, fee payment or anything else.
   */
  signAuthEntry: SignAuthEntry;
}

/**
 * reads the executor secret from the environment or from a file (for
 * mounted-secret deployments), mirroring the pattern in the relayer spike
 * this promotes from. Never both partially set: fail loudly rather than sign
 * with an unintended key.
 */
async function readSecret(varName: string): Promise<string> {
  const inline = process.env[varName];
  if (inline) return inline;
  const filePath = process.env[`${varName}_FILE`];
  if (filePath) return (await readFile(filePath, "utf8")).trim();
  throw new Error(`Missing ${varName} or ${varName}_FILE`);
}

export class EnvExecutorSigner implements ExecutorSigner {
  readonly signAuthEntry: SignAuthEntry;

  private constructor(private readonly keypair: Keypair, networkPassphrase: string) {
    this.signAuthEntry = basicNodeSigner(keypair, networkPassphrase).signAuthEntry;
  }

  static async fromEnv(
    networkPassphrase: string,
    varName = "PAYMOD_EXECUTOR_SECRET",
  ): Promise<EnvExecutorSigner> {
    const secret = await readSecret(varName);
    return new EnvExecutorSigner(Keypair.fromSecret(secret), networkPassphrase);
  }

  publicKey(): string {
    return this.keypair.publicKey();
  }
}

/**
 * same shape, for the relayer, a distinct role that pays XLM fees and submits,
 * but never authorizes a payment. Kept separate from `ExecutorSigner` so a type
 * error catches an accidental swap of the two keys.
 */
export interface RelayerSigner {
  publicKey(): string;
  keypair(): Keypair;
}

export class EnvRelayerSigner implements RelayerSigner {
  private constructor(private readonly kp: Keypair) {}

  static async fromEnv(varName = "PAYMOD_RELAYER_SECRET"): Promise<EnvRelayerSigner> {
    const secret = await readSecret(varName);
    return new EnvRelayerSigner(Keypair.fromSecret(secret));
  }

  publicKey(): string {
    return this.kp.publicKey();
  }

  keypair(): Keypair {
    return this.kp;
  }
}
