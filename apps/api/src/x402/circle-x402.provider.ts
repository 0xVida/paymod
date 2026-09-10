import type { Provider } from "@nestjs/common";
import { CircleApiClient, loadEntitySecretHex, loadEntityPublicKeyPem } from "@paymod/circle";
import {
  evmChainIdForCircleBlockchain,
  getCircleApiKey,
  getCircleBlockchain,
  getCircleRpcUrl,
  getCircleUsdcContractAddress,
} from "../settlement/circle-config.js";

export const CIRCLE_X402_SIGNER = Symbol("CIRCLE_X402_SIGNER");

export type CircleX402Signer = {
  client: CircleApiClient;
  entitySecretHex: string;
  entityPublicKeyPem: string;
  chainId: number;
  tokenAddress: string;
  rpcUrl: string;
};

/**
 * Own provider rather than reusing `CIRCLE_WALLET_RAIL`: x402 needs
 * `signTypedData` and on-chain reconciliation, neither of which
 * `CircleWalletRail`'s `PaymentRail` surface exposes - same reasoning
 * `stellarX402SignerProvider` already applies to Stellar.
 */
export const circleX402SignerProvider: Provider = {
  provide: CIRCLE_X402_SIGNER,
  useFactory: async (): Promise<CircleX402Signer> => {
    const blockchain = getCircleBlockchain();
    return {
      client: new CircleApiClient({ apiKey: getCircleApiKey() }),
      entitySecretHex: await loadEntitySecretHex(),
      entityPublicKeyPem: await loadEntityPublicKeyPem(),
      chainId: evmChainIdForCircleBlockchain(blockchain),
      tokenAddress: getCircleUsdcContractAddress(),
      rpcUrl: getCircleRpcUrl(),
    };
  },
};
