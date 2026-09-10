import type { CircleBlockchain } from "@paymod/circle";

/**
 * Centralizes the environment variables the Circle-facing modules share, so
 * there is exactly one place that defines what "the configured wallet set"
 * and "the active chain" mean.
 */

function requireEnv(varName: string): string {
  const value = process.env[varName];
  if (!value) throw new Error(`${varName} is not configured`);
  return value;
}

export function getCircleApiKey(): string {
  return requireEnv("CIRCLE_API_KEY");
}

export function getCircleWalletSetId(): string {
  return requireEnv("CIRCLE_WALLET_SET_ID");
}

export function getCircleBlockchain(): CircleBlockchain {
  return requireEnv("CIRCLE_BLOCKCHAIN") as CircleBlockchain;
}

/**
 * Circle's id for the specific USDC contract deployed on `CIRCLE_BLOCKCHAIN`,
 * not a universal "Circle USDC" id - every chain has its own contract and
 * Circle assigns each a distinct token id. Re-derive (see apps/api/circle.md)
 * if `CIRCLE_BLOCKCHAIN` ever changes.
 */
export function getCircleUsdcTokenId(): string {
  return requireEnv("CIRCLE_USDC_TOKEN_ID");
}

/**
 * CAIP-2 chain id per `CircleBlockchain`, for `AgentWallet.networkId`. Real
 * EIP-155 chain ids, not guessed - Circle's own blockchain enum names the
 * chain but not its numeric id.
 */
const CAIP2_BY_CIRCLE_BLOCKCHAIN: Record<CircleBlockchain, string> = {
  ETH: "eip155:1",
  "ETH-SEPOLIA": "eip155:11155111",
  BASE: "eip155:8453",
  "BASE-SEPOLIA": "eip155:84532",
  MATIC: "eip155:137",
  "MATIC-AMOY": "eip155:80002",
  ARB: "eip155:42161",
  "ARB-SEPOLIA": "eip155:421614",
  OP: "eip155:10",
  "OP-SEPOLIA": "eip155:11155420",
  AVAX: "eip155:43114",
  "AVAX-FUJI": "eip155:43113",
  UNI: "eip155:130",
  "UNI-SEPOLIA": "eip155:1301",
  MONAD: "eip155:143",
  "MONAD-TESTNET": "eip155:10143",
};

export function caip2ForCircleBlockchain(blockchain: CircleBlockchain): string {
  return CAIP2_BY_CIRCLE_BLOCKCHAIN[blockchain];
}

/** numeric EIP-155 chain id, for the EIP-712 domain x402's eip3009 signing needs - `caip2ForCircleBlockchain`'s own value with the `eip155:` prefix stripped. */
export function evmChainIdForCircleBlockchain(blockchain: CircleBlockchain): number {
  return Number(CAIP2_BY_CIRCLE_BLOCKCHAIN[blockchain].split(":")[1]);
}

/**
 * the on-chain USDC contract address, distinct from `CIRCLE_USDC_TOKEN_ID`
 * (Circle's internal id for the same token). x402's `PaymentRequirements.asset`
 * and the EIP-712 `verifyingContract` field both need a real contract
 * address, never Circle's internal id.
 */
export function getCircleUsdcContractAddress(): string {
  return requireEnv("CIRCLE_USDC_CONTRACT_ADDRESS");
}

/**
 * Public RPC endpoint for `CIRCLE_BLOCKCHAIN`, used only for read-only
 * `eth_call`s reconciling an x402 authorization's used/unused state - never
 * for anything that spends money, so its rate limits are an acceptable
 * risk. Override with `CIRCLE_RPC_URL` if the default gets flaky.
 */
const DEFAULT_RPC_BY_CIRCLE_BLOCKCHAIN: Partial<Record<CircleBlockchain, string>> = {
  "ETH-SEPOLIA": "https://ethereum-sepolia-rpc.publicnode.com",
  "BASE-SEPOLIA": "https://base-sepolia-rpc.publicnode.com",
  ETH: "https://ethereum-rpc.publicnode.com",
  BASE: "https://base-rpc.publicnode.com",
};

export function getCircleRpcUrl(): string {
  const override = process.env["CIRCLE_RPC_URL"];
  if (override) return override;
  const blockchain = getCircleBlockchain();
  const url = DEFAULT_RPC_BY_CIRCLE_BLOCKCHAIN[blockchain];
  if (!url) throw new Error(`No default RPC URL for ${blockchain} - set CIRCLE_RPC_URL explicitly`);
  return url;
}
