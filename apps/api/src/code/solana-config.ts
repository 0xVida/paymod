import { Keypair, PublicKey } from "@solana/web3.js";

/**
 * Solana-facing env vars for Paymod Code's deposit flow. Unlike
 * `settlement/stellar-config.ts`, these fail closed in production instead
 * of defaulting to devnet: a deposit address silently pointed at devnet
 * would mean real deposits are never credited, worse than refusing to start.
 */

const DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function getSolanaRpcUrl(): string {
  const url = process.env.SOLANA_RPC_URL;
  if (url) return url;
  if (isProduction()) throw new Error("SOLANA_RPC_URL must be set in production");
  return "https://api.devnet.solana.com";
}

export function getUsdcMint(): PublicKey {
  const mint = process.env.SOLANA_USDC_MINT;
  if (mint) return new PublicKey(mint);
  if (isProduction()) throw new Error("SOLANA_USDC_MINT must be set in production");
  return new PublicKey(DEVNET_USDC_MINT);
}

/** where swept USDC ends up. No devnet default - unlike the RPC URL or the USDC mint, there's no safe placeholder for "where does Paymod's money go." */
export function getTreasuryUsdcAddress(): PublicKey {
  const address = process.env.SOLANA_TREASURY_ADDRESS;
  if (!address) throw new Error("SOLANA_TREASURY_ADDRESS is not configured");
  return new PublicKey(address);
}

/**
 * Pays the SOL fee for a sweep as fee payer only, never as transfer
 * authority (that stays the deposit address's own keypair). Needed because
 * a deposit address only ever holds USDC, never SOL for fees. Blast radius
 * is bounded to wasting its own SOL - it can't move USDC without the
 * deposit address's own signature. No devnet default, same reasoning as
 * the treasury address.
 */
export function getRelayerKeypair(): Keypair {
  const secret = process.env.SOLANA_RELAYER_SECRET_KEY;
  if (!secret) throw new Error("SOLANA_RELAYER_SECRET_KEY is not configured");
  return Keypair.fromSecretKey(Buffer.from(secret, "base64"));
}
