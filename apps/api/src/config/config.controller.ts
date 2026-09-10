import { Controller, Get } from "@nestjs/common";
import {
  getPaymodExecutorPublicKey,
  getStellarNetworkPassphrase,
  getStellarRpcUrl,
  getTreasuryWasmHash,
  getUsdcContractId,
} from "../settlement/stellar-config.js";

/**
 * Public, unauthenticated: everything a browser needs to build a treasury
 * deploy transaction itself (Freighter flow) without hardcoding chain
 * config into the frontend bundle. Nothing here is a secret.
 */
@Controller("v1")
export class ConfigController {
  @Get("config")
  get() {
    return {
      network: "stellar:testnet",
      networkPassphrase: getStellarNetworkPassphrase(),
      rpcUrl: getStellarRpcUrl(),
      executorPublicKey: getPaymodExecutorPublicKey(),
      usdcContractId: getUsdcContractId(),
      treasuryWasmHash: getTreasuryWasmHash(),
    };
  }
}
