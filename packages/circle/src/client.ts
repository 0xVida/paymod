import type { CircleTransaction, CircleTransactionState } from "./state-mapping.js";

/**
 * confirmed chain list for Circle's Developer-Controlled Wallets (D in the
 * plan). no Stellar entry - SOL/SOL-DEVNET are present but this rail is
 * EVM-only per the current implementation scope.
 */
export type CircleBlockchain =
  | "ETH"
  | "ETH-SEPOLIA"
  | "AVAX"
  | "AVAX-FUJI"
  | "MATIC"
  | "MATIC-AMOY"
  | "ARB"
  | "ARB-SEPOLIA"
  | "UNI"
  | "UNI-SEPOLIA"
  | "BASE"
  | "BASE-SEPOLIA"
  | "OP"
  | "OP-SEPOLIA"
  | "MONAD"
  | "MONAD-TESTNET";

export type CircleWallet = {
  id: string;
  address: string;
  blockchain: CircleBlockchain;
  state: "LIVE" | "FROZEN";
  walletSetId: string;
  custodyType: "DEVELOPER";
};

export type CircleTokenBalance = {
  amount: string;
  token: { id: string; symbol: string; blockchain: CircleBlockchain };
};

export type CircleTransactionRecord = CircleTransaction & { id: string };

export class CircleApiError extends Error {
  readonly httpStatus: number;
  readonly circleErrorCode: number | undefined;

  private constructor(message: string, httpStatus: number, circleErrorCode: number | undefined) {
    super(message);
    this.name = "CircleApiError";
    this.httpStatus = httpStatus;
    this.circleErrorCode = circleErrorCode;
  }

  static async fromResponse(response: Response): Promise<CircleApiError> {
    const body: unknown = await response.json().catch(() => undefined);
    if (typeof body === "object" && body !== null && "message" in body) {
      const message = String((body as { message: unknown }).message);
      const code = "code" in body ? Number((body as { code: unknown }).code) : undefined;
      return new CircleApiError(message, response.status, code);
    }
    return new CircleApiError(`Circle API request failed with status ${response.status}`, response.status, undefined);
  }
}

export type CircleApiClientOptions = {
  apiKey: string;
  baseUrl?: string;
};

const DEFAULT_BASE_URL = "https://api.circle.com/v1/w3s";

/**
 * thin fetch wrapper around Circle's REST API instead of the official SDK, matching
 * this repo's explicit-HTTP-client pattern (see `packages/sdk/src/client.ts`). mutating
 * calls take a caller-supplied `entitySecretCiphertext` - this client never touches the raw secret.
 */
export class CircleApiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: CircleApiClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  }

  async createWallet(input: {
    idempotencyKey: string;
    entitySecretCiphertext: string;
    walletSetId: string;
    blockchain: CircleBlockchain;
  }): Promise<CircleWallet> {
    const response = await this.request<{ wallets: CircleWallet[] }>("POST", "/developer/wallets", {
      idempotencyKey: input.idempotencyKey,
      entitySecretCiphertext: input.entitySecretCiphertext,
      walletSetId: input.walletSetId,
      blockchains: [input.blockchain],
      accountType: "EOA",
      count: 1,
    });
    const wallet = response.wallets[0];
    if (!wallet) throw new Error("Circle createWallet returned no wallets");
    return wallet;
  }

  async getWallet(walletId: string): Promise<CircleWallet> {
    const response = await this.request<{ wallet: CircleWallet }>("GET", `/wallets/${walletId}`);
    return response.wallet;
  }

  async getWalletBalances(walletId: string): Promise<CircleTokenBalance[]> {
    const response = await this.request<{ tokenBalances: CircleTokenBalance[] }>(
      "GET",
      `/wallets/${walletId}/balances`,
    );
    return response.tokenBalances;
  }

  async createTransfer(input: {
    idempotencyKey: string;
    entitySecretCiphertext: string;
    walletId: string;
    destinationAddress: string;
    tokenId: string;
    amount: string;
  }): Promise<CircleTransactionRecord> {
    const response = await this.request<{ id: string; state: CircleTransactionState }>(
      "POST",
      "/developer/transactions/transfer",
      {
        idempotencyKey: input.idempotencyKey,
        entitySecretCiphertext: input.entitySecretCiphertext,
        walletId: input.walletId,
        destinationAddress: input.destinationAddress,
        tokenId: input.tokenId,
        amounts: [input.amount],
        feeLevel: "MEDIUM",
      },
    );
    return this.getTransaction(response.id);
  }

  async getTransaction(transactionId: string): Promise<CircleTransactionRecord> {
    const response = await this.request<{ transaction: CircleTransactionRecord }>(
      "GET",
      `/transactions/${transactionId}`,
    );
    return response.transaction;
  }

  /**
   * signs EIP-712 typed data without broadcasting, used by `x402-signer.ts` to produce
   * EIP-3009 `TransferWithAuthorization` signatures, not plain transfers. `data` is the
   * typed-data object (`{types, domain, primaryType, message}`) as a JSON string.
   */
  async signTypedData(input: {
    entitySecretCiphertext: string;
    walletId: string;
    data: string;
  }): Promise<{ signature: string }> {
    return this.request<{ signature: string }>("POST", "/developer/sign/typedData", {
      entitySecretCiphertext: input.entitySecretCiphertext,
      walletId: input.walletId,
      data: input.data,
    });
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...(body !== undefined && { "Content-Type": "application/json" }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw await CircleApiError.fromResponse(response);
    const parsed = (await response.json()) as { data: T };
    return parsed.data;
  }
}
