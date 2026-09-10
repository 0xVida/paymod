import type { Provider } from "@nestjs/common";
import { Server } from "@stellar/stellar-sdk/rpc";
import { EnvExecutorSigner, EnvRelayerSigner, type ExecutorSigner, type RelayerSigner } from "@paymod/stellar";
import { getStellarNetworkPassphrase, getStellarRpcUrl } from "../settlement/stellar-config.js";

export const STELLAR_X402_SIGNER = Symbol("STELLAR_X402_SIGNER");

export type StellarX402Signer = {
  server: Server;
  networkPassphrase: string;
  executor: ExecutorSigner;
  relayer: RelayerSigner;
};

/**
 * same executor/relayer keys `stellarPaymentRailProvider` uses for
 * `execute_payment`: x402 payments use the identical `__check_auth`-verified
 * executor signature (ADR 0008), just against a direct token transfer. Kept
 * separate rather than threading `StellarPaymentRail` through the x402
 * module, since x402 doesn't use its `prepare`/`submit`/`confirm` lifecycle.
 */
export const stellarX402SignerProvider: Provider = {
  provide: STELLAR_X402_SIGNER,
  useFactory: async (): Promise<StellarX402Signer> => {
    const networkPassphrase = getStellarNetworkPassphrase();
    const server = new Server(getStellarRpcUrl());
    const executor = await EnvExecutorSigner.fromEnv(networkPassphrase);
    const relayer = await EnvRelayerSigner.fromEnv();
    return { server, networkPassphrase, executor, relayer };
  },
};
