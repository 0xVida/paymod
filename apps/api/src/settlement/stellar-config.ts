import { Networks } from "@stellar/stellar-sdk";

/**
 * Centralizes the environment variables the Stellar-facing modules share, so
 * there is exactly one place that defines what "the configured executor" and
 * "the RPC endpoint" mean.
 */

export function getStellarRpcUrl(): string {
  return process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";
}

export function getStellarNetworkPassphrase(): string {
  return process.env.STELLAR_NETWORK_PASSPHRASE ?? Networks.TESTNET;
}

/**
 * the public key `POST /v1/wallets/:id/activate` requires every activated
 * wallet's on-chain executor to match. Derived from the same secret the
 * settlement worker signs with, so activation can never silently drift from
 * what actually executes payments.
 */
export function getPaymodExecutorPublicKey(): string {
  const key = process.env.PAYMOD_EXECUTOR_PUBLIC_KEY;
  if (!key) throw new Error("PAYMOD_EXECUTOR_PUBLIC_KEY is not configured");
  return key;
}

/** the SEP-41 USDC contract every treasury is provisioned with: one canonical source, not a string repeated per script. */
export function getUsdcContractId(): string {
  const id = process.env.STELLAR_USDC_CONTRACT_ID;
  if (!id) throw new Error("STELLAR_USDC_CONTRACT_ID is not configured");
  return id;
}

/**
 * the already-uploaded WASM hash of the current Treasury Contract version:
 * lets a browser-side deploy (dashboard, Freighter) create a new instance
 * via `CreateContractArgs` without re-uploading the contract bytes itself.
 */
export function getTreasuryWasmHash(): string {
  const hash = process.env.PAYMOD_TREASURY_WASM_HASH;
  if (!hash) throw new Error("PAYMOD_TREASURY_WASM_HASH is not configured");
  return hash;
}
