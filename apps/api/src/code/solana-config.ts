import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

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

/**
 * Optional: some RPC providers (Tatum, among others) gate real methods
 * like `getSignaturesForAddress` behind an API key sent as a header, not
 * a URL query param - passing none is fine for providers that don't
 * require it (the public devnet default, a provider that embeds the key
 * in the URL itself).
 */
function getSolanaRpcApiKey(): string | undefined {
  return process.env.SOLANA_RPC_API_KEY;
}

/** optional backup RPC endpoint, tried only if the primary's call rejects - never required, unlike `SOLANA_RPC_URL` itself. */
function getSolanaRpcUrl2(): string | undefined {
  return process.env.SOLANA_RPC_URL_2;
}

/**
 * Transparent per-call failover: every method call on the returned object
 * tries the primary connection first and, only on rejection, retries the
 * same call against the secondary. Real Solana RPC providers do go down
 * or rate-limit independently of each other, and a `Connection` has no
 * built-in multi-endpoint mode - wrapping it in a `Proxy` gets failover
 * for every method (`getSignaturesForAddress`, `sendAndConfirmTransaction`,
 * etc.) without hand-wrapping each call site that uses one.
 */
function withFailover(primary: Connection, secondary: Connection): Connection {
  return new Proxy(primary, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        try {
          return await value.apply(target, args);
        } catch (primaryError) {
          try {
            const fallback = Reflect.get(secondary, property, secondary);
            return await fallback.apply(secondary, args);
          } catch {
            throw primaryError;
          }
        }
      };
    },
  });
}

/** the one place a `Connection` gets constructed - `sweep.service.ts` and `deposit.service.ts` both use this rather than building their own, so the API key header (and the optional backup endpoint) is never forgotten at a second call site. */
export function createSolanaConnection(): Connection {
  const apiKey = getSolanaRpcApiKey();
  const primary = new Connection(getSolanaRpcUrl(), {
    commitment: "confirmed",
    ...(apiKey && { httpHeaders: { "x-api-key": apiKey } }),
  });

  const secondaryUrl = getSolanaRpcUrl2();
  if (!secondaryUrl) return primary;

  const secondary = new Connection(secondaryUrl, { commitment: "confirmed" });
  return withFailover(primary, secondary);
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
 *
 * base58, not base64: the format every Solana wallet (Phantom, Solflare)
 * and the CLI already export/import a secret key as, so no conversion
 * step is needed between generating or exporting the key and pasting it
 * in here.
 */
export function getRelayerKeypair(): Keypair {
  const secret = process.env.SOLANA_RELAYER_SECRET_KEY;
  if (!secret) throw new Error("SOLANA_RELAYER_SECRET_KEY is not configured");
  return Keypair.fromSecretKey(bs58.decode(secret));
}
