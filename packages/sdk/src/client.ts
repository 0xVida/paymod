import { randomUUID } from "node:crypto";
import { throwForFailedResponse } from "./errors.js";

export type TransferRequest = {
  amount: string;
  destination: string;
  purpose?: string;
};

export type TransferResponse = {
  requestId: string;
  intentId: string;
  status: "AUTHORIZED" | "WAITING_APPROVAL" | "DENIED";
  reason?: string;
};

export type BudgetWindow = {
  window: "DAY" | "MONTH";
  limitAtomic: string;
  spentAtomic: string;
  reservedAtomic: string;
  availableAtomic: string;
};

export type BalanceResponse = { networkId: string; assetCode: string; available: string };

export type X402PayResponse =
  | { status: "FETCHED_DIRECTLY"; httpStatus: number; contentType: string | null; body: string }
  | { status: "COMPLETED"; intentId: string; httpStatus: number; contentType: string | null; body: string; txHash: string; amountAtomic: string }
  | { status: "DENIED"; intentId: string; reason: string }
  | { status: "WAITING_APPROVAL"; intentId: string; reason: string }
  | { status: "FAILED"; intentId: string; reason: string }
  | { status: "UNKNOWN"; intentId: string; reason: string };

export type RequestStatus = {
  id: string;
  status: string;
  decision?: string | null;
  decisionReason?: string | null;
  settlement?: { status: string; txHash: string | null } | null;
};

const TERMINAL_INTENT_STATUSES = new Set(["COMPLETED", "DENIED", "FAILED", "EXPIRED"]);

export function isTerminalIntentStatus(status: string): boolean {
  return TERMINAL_INTENT_STATUSES.has(status);
}

export type PaymodClientOptions = {
  apiKey: string;
  baseUrl?: string;
};

export type WaitForRequestOptions = {
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
};

const DEFAULT_BASE_URL = "http://localhost:3001";
const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_POLL_TIMEOUT_MS = 60_000;

export class PaymodClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: PaymodClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  }

  async getBalance(): Promise<BalanceResponse> {
    return this.request<BalanceResponse>("GET", "/v1/wallet/balance");
  }

  async getBudget(): Promise<{ windows: BudgetWindow[] }> {
    return this.request("GET", "/v1/budget");
  }

  /** omitting `idempotencyKey` generates a random one, safe for a one-off call the caller won't retry. */
  async transfer(input: TransferRequest, idempotencyKey?: string): Promise<TransferResponse> {
    return this.request("POST", "/v1/transfers", input, idempotencyKey ?? randomUUID());
  }

  async getRequestStatus(intentId: string): Promise<RequestStatus> {
    return this.request("GET", `/v1/intents/${intentId}`);
  }

  /**
   * Fetches a paywalled resource, paying via x402 if the server responds
   * 402. Checked against policy the same as `transfer()`: the response's
   * `status` carries the same three-valued decision (`DENIED` /
   * `WAITING_APPROVAL` / a completed fetch), never a partial payment.
   */
  async payX402(url: string): Promise<X402PayResponse> {
    return this.request("POST", "/v1/x402/fetch", { url });
  }

  async getX402Result(intentId: string): Promise<X402PayResponse> {
    return this.request("GET", `/v1/x402/${intentId}/result`);
  }

  /** polls until the intent reaches a terminal status or rejects on timeout/abort. */
  async waitForRequest(intentId: string, options: WaitForRequestOptions = {}): Promise<RequestStatus> {
    const intervalMs = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const timeoutMs = options.timeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;

    while (true) {
      options.signal?.throwIfAborted();
      const status = await this.getRequestStatus(intentId);
      if (isTerminalIntentStatus(status.status)) return status;
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for ${intentId} to reach a terminal status`);
      }
      await sleep(intervalMs, options.signal);
    }
  }

  private async request<T>(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...(body !== undefined && { "Content-Type": "application/json" }),
        ...(idempotencyKey !== undefined && { "Idempotency-Key": idempotencyKey }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    if (!response.ok) return throwForFailedResponse(response);
    return response.json() as Promise<T>;
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });
}
