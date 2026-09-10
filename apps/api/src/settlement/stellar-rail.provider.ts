import type { Provider } from "@nestjs/common";
import { Server } from "@stellar/stellar-sdk/rpc";
import { StellarPaymentRail, EnvExecutorSigner, EnvRelayerSigner } from "@paymod/stellar";
import { getStellarNetworkPassphrase, getStellarRpcUrl } from "./stellar-config.js";
import { PAYMENT_RAIL } from "./payment-rail.token.js";

/**
 * dormant: not imported by `settlement.module.ts` today, Circle is the
 * active rail (`circle-rail.provider.ts`). Kept ready to bind to
 * `PAYMENT_RAIL` again for a future multi-chain expansion.
 */
export const stellarPaymentRailProvider: Provider = {
  provide: PAYMENT_RAIL,
  useFactory: async () => {
    const passphrase = getStellarNetworkPassphrase();
    const server = new Server(getStellarRpcUrl());
    const executor = await EnvExecutorSigner.fromEnv(passphrase);
    const relayer = await EnvRelayerSigner.fromEnv();
    return new StellarPaymentRail(server, executor, relayer, passphrase);
  },
};
