import { Address, xdr, scValToNative, nativeToScVal } from "@stellar/stellar-sdk";
import { Server, Durability, Api } from "@stellar/stellar-sdk/rpc";
import { AssembledTransaction } from "@stellar/stellar-sdk/contract";

/**
 * reads the treasury contract's full on-chain state in one RPC round-trip.
 *
 * Contract v2 (ADR 0007) added getters for every field here, but this
 * still decodes the raw instance storage entry directly: N getters cost
 * N simulated round-trips (Soroban has no batch call), while decoding
 * gets them all in one `getContractData`. `spent_in_period`'s getter now
 * applies the lazy-reset itself, but this function still corrects it
 * locally to avoid a second call for that one field.
 *
 * Soroban encodes a Rust enum as an ScVal vector: a unit variant like
 * `DataKey::Owner` becomes `[Symbol("Owner")]`, a tuple variant like
 * `DataKey::Executed(id)` becomes `[Symbol("Executed"), id]`. Decoded via
 * `scValToNative` that's a JS array whose first element is the variant name.
 *
 * `Executed(payment_id)` moved to `temporary` storage in contract v2
 * (ADR 0007 defect 3: it grew a single instance entry without bound), so
 * it can no longer be enumerated this way - check one id with
 * `isPaymentExecuted` instead.
 */

export type TreasuryState = {
  owner: string;
  executor: string;
  token: string;
  paused: boolean;
  maxPerPaymentAtomic: string;
  maxPerPeriodAtomic: string;
  periodSeconds: number;
  periodStart: number;
  /** raw on-chain value. May be stale: see `spentInPeriodAtomic` for the corrected figure. */
  rawSpentInPeriodAtomic: string;
  /**
   * `rawSpentInPeriodAtomic`, corrected for the lazy reset the contract itself
   * would apply on the next `execute_payment` call. Use this, not the raw
   * field, to compute remaining on-chain headroom.
   */
  spentInPeriodAtomic: string;
  /** the ledger this snapshot was read at, for staleness checks by the caller. */
  latestLedger: number;
  /** the ledger the contract's state was last written at. */
  lastModifiedLedger: number | undefined;
};

function decodeInstanceStorage(instance: xdr.ScContractInstance): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const entry of instance.storage() ?? []) {
    const key = scValToNative(entry.key());
    if (!Array.isArray(key) || key.length === 0 || typeof key[0] !== "string") continue;
    const [variant, payload] = key;
    out.set(variant, payload !== undefined ? payload : scValToNative(entry.val()));
  }
  return out;
}

export async function readTreasuryState(
  server: Server,
  contractId: string,
  now: Date = new Date(),
): Promise<TreasuryState> {
  const key = xdr.ScVal.scvLedgerKeyContractInstance();
  const [entry, latest] = await Promise.all([
    server.getContractData(contractId, key, Durability.Persistent),
    server.getLatestLedger(),
  ]);
  const instance = entry.val.contractData().val().instance();
  const storage = decodeInstanceStorage(instance);

  const owner = String(storage.get("Owner"));
  const executor = String(storage.get("Executor"));
  const token = String(storage.get("Token"));
  const paused = Boolean(storage.get("Paused"));
  const maxPerPaymentAtomic = String(storage.get("MaxPerPayment"));
  const maxPerPeriodAtomic = String(storage.get("MaxPerPeriod"));
  const periodSeconds = Number(storage.get("PeriodSeconds"));
  const periodStart = Number(storage.get("PeriodStart"));
  const rawSpentInPeriodAtomic = String(storage.get("SpentInPeriod"));

  const nowSeconds = Math.floor(now.getTime() / 1000);
  const windowElapsed = nowSeconds >= periodStart + periodSeconds;
  const spentInPeriodAtomic = windowElapsed ? "0" : rawSpentInPeriodAtomic;

  return {
    owner,
    executor,
    token,
    paused,
    maxPerPaymentAtomic,
    maxPerPeriodAtomic,
    periodSeconds,
    periodStart,
    rawSpentInPeriodAtomic,
    spentInPeriodAtomic,
    latestLedger: latest.sequence,
    lastModifiedLedger: entry.lastModifiedLedgerSeq,
  };
}

/**
 * checks one `payment_id` via the contract's `is_payment_executed` getter
 * (a free simulated call) rather than enumerating every executed id:
 * `Executed` lives in `temporary` storage as of contract v2, which
 * `readTreasuryState` can't list the way it reads everything else.
 * Every real caller checks one known id anyway, never the full set.
 */
export async function isPaymentExecuted(
  server: Server,
  contractId: string,
  networkPassphrase: string,
  paymentIdBytes: Buffer,
): Promise<boolean> {
  const assembled = await AssembledTransaction.build({
    contractId,
    method: "is_payment_executed",
    args: [nativeToScVal(paymentIdBytes, { type: "bytes" })],
    networkPassphrase,
    rpcUrl: server.serverURL.toString(),
    parseResultXdr: (result) => result,
  });
  if (!assembled.simulation) {
    throw new Error("is_payment_executed simulation did not run");
  }
  if (Api.isSimulationError(assembled.simulation)) {
    throw new Error(`is_payment_executed simulation failed: ${assembled.simulation.error}`);
  }
  return scValToNative(assembled.result) as boolean;
}

export function assertTreasuryUsableBy(
  state: TreasuryState,
  expected: { executor: string; token: string },
): void {
  if (state.paused) throw new Error("Treasury is paused");
  if (state.executor !== expected.executor) {
    throw new Error(
      `Treasury executor is ${state.executor}, not the configured Paymod executor ${expected.executor}`,
    );
  }
  if (state.token !== expected.token) {
    throw new Error(`Treasury token is ${state.token}, expected ${expected.token}`);
  }
}

/** uses `Address` from the SDK so a malformed id fails loudly at the boundary. */
export function assertValidContractId(contractId: string): string {
  Address.fromString(contractId).toScAddress();
  return contractId;
}
