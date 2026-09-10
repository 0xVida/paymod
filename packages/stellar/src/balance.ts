import {
  Account,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
} from "@stellar/stellar-sdk";
import { Api, Server } from "@stellar/stellar-sdk/rpc";

/**
 * `balance` is read-only: simulation needs a syntactically valid classic
 * source account to build the envelope, but it never needs to exist, be
 * funded or match the holder being queried, verified empirically against
 * the live network, including reading a treasury CONTRACT's own balance
 * (a C-address, which can't itself be a transaction source). Fixed
 * rather than randomly generated so behavior stays reproducible.
 */
const SIMULATION_SOURCE = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1)).publicKey();

/**
 * reads an address's balance of a SAC (Stellar Asset Contract) token by
 * simulating its `balance` method: no transaction is submitted, no fee is
 * paid and no issuer/classic-asset lookup is needed, only the SAC contract
 * id already stored on `WalletAsset`. `holderAddress` may be a classic
 * account or a contract address; both are valid SAC balance holders.
 */
export async function readTokenBalance(
  server: Server,
  tokenContractId: string,
  holderAddress: string,
  networkPassphrase: string = Networks.TESTNET,
): Promise<bigint> {
  const contract = new Contract(tokenContractId);
  const simulationSource = new Account(SIMULATION_SOURCE, "0");
  const tx = new TransactionBuilder(simulationSource, {
    fee: "100",
    networkPassphrase,
  })
    .addOperation(contract.call("balance", nativeToScVal(holderAddress, { type: "address" })))
    .setTimeout(30)
    .build();

  const simulation = await server.simulateTransaction(tx);
  if (Api.isSimulationError(simulation)) {
    throw new Error(`Balance simulation failed: ${simulation.error}`);
  }
  if (!simulation.result) {
    throw new Error("Balance simulation returned no result");
  }
  return BigInt(scValToNative(simulation.result.retval) as bigint | number | string);
}
