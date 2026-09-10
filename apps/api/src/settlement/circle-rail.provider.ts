import type { Provider } from "@nestjs/common";
import { CircleWalletRail, loadEntitySecretHex, loadEntityPublicKeyPem } from "@paymod/circle";
import { caip2ForCircleBlockchain, getCircleApiKey, getCircleBlockchain, getCircleUsdcTokenId, getCircleWalletSetId } from "./circle-config.js";
import { PAYMENT_RAIL } from "./payment-rail.token.js";

/**
 * shared by both providers below: `PAYMENT_RAIL` (chain-neutral
 * `PaymentRail`, used by settlement) and `CIRCLE_WALLET_RAIL` (typed
 * concretely, used by `WalletsController.createWallet()` - not part of
 * `PaymentRail` yet, see `rail.ts`). Two separate instances rather than
 * aliasing one to the other: `CircleWalletRail` holds no mutable state, so
 * the duplication costs nothing but a few bytes.
 */
export async function buildCircleWalletRail(): Promise<CircleWalletRail> {
  const blockchain = getCircleBlockchain();
  return new CircleWalletRail({
    network: caip2ForCircleBlockchain(blockchain),
    blockchain,
    tokenId: getCircleUsdcTokenId(),
    apiKey: getCircleApiKey(),
    walletSetId: getCircleWalletSetId(),
    entitySecretHex: await loadEntitySecretHex(),
    entityPublicKeyPem: await loadEntityPublicKeyPem(),
  });
}

export const CIRCLE_WALLET_RAIL = Symbol("CIRCLE_WALLET_RAIL");

export const circlePaymentRailProvider: Provider = {
  provide: PAYMENT_RAIL,
  useFactory: buildCircleWalletRail,
};

export const circleWalletRailProvider: Provider = {
  provide: CIRCLE_WALLET_RAIL,
  useFactory: buildCircleWalletRail,
};
