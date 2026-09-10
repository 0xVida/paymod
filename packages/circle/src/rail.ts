import type {
  NetworkId,
  PaymentRail,
  PreparedSettlement,
  SettlementIntent,
  SettlementOutcome,
  SettlementSubmission,
  WalletState,
} from "@paymod/payments";
import { isValidEvmAddress } from "./address.js";
import { fromAtomicUsdc, toAtomicUsdc } from "./amount.js";
import { CircleApiClient, type CircleBlockchain, type CircleWallet } from "./client.js";
import { encryptEntitySecret } from "./entity-secret.js";
import { circleIdempotencyKey, circleWalletIdempotencyKey } from "./idempotency.js";
import { mapCircleStateToOutcome } from "./state-mapping.js";

type CirclePreparedPayload = {
  idempotencyKey: string;
  entitySecretCiphertext: string;
  walletId: string;
  destinationAddress: string;
  tokenId: string;
  amount: string;
};

export type CircleWalletRailOptions = {
  network: NetworkId;
  blockchain: CircleBlockchain;
  /** Circle's own token id for USDC on this chain (Circle assigns one per chain, not derivable from the symbol alone) */
  tokenId: string;
  apiKey: string;
  walletSetId: string;
  entitySecretHex: string;
  entityPublicKeyPem: string;
  baseUrl?: string;
};

/**
 * `PaymentRail` backed by Circle's Developer-Controlled Wallets API. Circle signs
 * server-side via its own MPC given an entity-secret ciphertext, so unlike
 * `StellarPaymentRail` there is no executor/relayer split - `prepare()` only validates
 * and encrypts a fresh ciphertext, `submit()` makes the actual network call.
 */
export class CircleWalletRail implements PaymentRail {
  readonly network: NetworkId;
  private readonly client: CircleApiClient;
  private readonly blockchain: CircleBlockchain;
  private readonly tokenId: string;
  private readonly walletSetId: string;
  private readonly entitySecretHex: string;
  private readonly entityPublicKeyPem: string;

  constructor(options: CircleWalletRailOptions) {
    this.network = options.network;
    this.blockchain = options.blockchain;
    this.tokenId = options.tokenId;
    this.walletSetId = options.walletSetId;
    this.entitySecretHex = options.entitySecretHex;
    this.entityPublicKeyPem = options.entityPublicKeyPem;
    this.client = new CircleApiClient({
      apiKey: options.apiKey,
      ...(options.baseUrl !== undefined && { baseUrl: options.baseUrl }),
    });
  }

  validateDestination(address: string): boolean {
    return isValidEvmAddress(address);
  }

  async readWalletState(externalWalletId: string): Promise<WalletState> {
    const wallet = await this.client.getWallet(externalWalletId);
    const balances = await this.client.getWalletBalances(externalWalletId);
    const usdcBalance = balances.find((balance) => balance.token.symbol === "USDC");
    return {
      networkId: this.network,
      address: wallet.address,
      paused: wallet.state !== "LIVE",
      // Circle has no per-wallet on-chain executor role - the wallet set is the
      // authority expected to control this wallet's key material
      executor: this.walletSetId,
      assetCode: "USDC",
      balanceAtomic: usdcBalance ? toAtomicUsdc(usdcBalance.amount) : "0",
    };
  }

  async prepare(intent: SettlementIntent): Promise<PreparedSettlement> {
    if (!this.validateDestination(intent.destination)) {
      throw new Error(`Invalid EVM destination address: ${intent.destination}`);
    }
    const payload: CirclePreparedPayload = {
      idempotencyKey: circleIdempotencyKey(intent.paymentId),
      entitySecretCiphertext: encryptEntitySecret(this.entitySecretHex, this.entityPublicKeyPem),
      walletId: intent.externalWalletId,
      destinationAddress: intent.destination,
      tokenId: this.tokenId,
      amount: fromAtomicUsdc(intent.atomicAmount),
    };
    return {
      intentId: intent.intentId,
      networkId: this.network,
      paymentId: intent.paymentId,
      requestedAtomicAmount: intent.atomicAmount,
      payload,
      preparedAt: new Date(),
      // Circle's entitySecretCiphertext is single-use and short-lived by
      // Circle's own design - an hour is a conservative bound, not measured
      // against a documented Circle TTL, so submit soon after prepare
      expiresAt: new Date(Date.now() + 60 * 60_000),
    };
  }

  async submit(prepared: PreparedSettlement): Promise<SettlementSubmission> {
    const payload = prepared.payload as CirclePreparedPayload;
    const record = await this.client.createTransfer(payload);
    return {
      intentId: prepared.intentId,
      networkId: this.network,
      paymentId: prepared.paymentId,
      requestedAtomicAmount: prepared.requestedAtomicAmount,
      txRef: record.id,
      submittedAt: new Date(),
    };
  }

  /**
   * never trusts webhook delivery alone (D, H) - always re-fetches the
   * transaction's current state directly from Circle before mapping it to
   * a `SettlementOutcome`.
   */
  async confirm(submission: SettlementSubmission): Promise<SettlementOutcome> {
    const record = await this.client.getTransaction(submission.txRef);
    return mapCircleStateToOutcome(record, submission.requestedAtomicAmount);
  }

  /**
   * not part of `PaymentRail` - wallet lifecycle stays package-local until the shared
   * interface is extended (plan Milestone 2), which also needs the same members on
   * `StellarPaymentRail`.
   *
   * `walletId` is Paymod's `AgentWallet.id`, not Circle's - the idempotency key derives
   * from it deterministically so a retry after a crash recovers the same Circle wallet
   * instead of creating an orphaned duplicate.
   */
  async createWallet(walletId: string): Promise<CircleWallet> {
    return this.client.createWallet({
      idempotencyKey: circleWalletIdempotencyKey(walletId),
      entitySecretCiphertext: encryptEntitySecret(this.entitySecretHex, this.entityPublicKeyPem),
      walletSetId: this.walletSetId,
      blockchain: this.blockchain,
    });
  }
}
