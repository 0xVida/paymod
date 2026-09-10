export type DeviceStartResponse = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
};

export type DevicePollResponse =
  | { status: "pending" }
  | { status: "denied" }
  | { status: "expired" }
  | { status: "approved"; credential: string };

/** thin fetch client for `apps/api`'s `/v1/code/device/*` endpoints. No auth on start/poll: the device code itself is the bearer secret. */
export class PaymodCodeClient {
  constructor(private readonly apiUrl: string) {}

  startDeviceAuth(): Promise<DeviceStartResponse> {
    return this.post<DeviceStartResponse>("/v1/code/device/start");
  }

  pollDeviceAuth(deviceCode: string): Promise<DevicePollResponse> {
    return this.post<DevicePollResponse>("/v1/code/device/poll", { deviceCode });
  }

  /** `GET /v1/code/wallet/balance`, `CodeCredentialGuard`-gated - a read-only ledger lookup, the real number PAYMOD_CODE_PLAN.md's balance work replaces the old `$18.42` placeholder with. */
  async getBalance(credential: string): Promise<{ balanceUsd: number }> {
    const response = await fetch(`${this.apiUrl}/v1/code/wallet/balance`, { headers: { "x-api-key": credential } });
    if (!response.ok) {
      const payload = (await response.json().catch(() => undefined)) as { error?: { message?: string } } | undefined;
      throw new Error(payload?.error?.message ?? `Request failed (${response.status})`);
    }
    return response.json() as Promise<{ balanceUsd: number }>;
  }

  private async post<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.apiUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => undefined)) as { error?: { message?: string } } | undefined;
      throw new Error(payload?.error?.message ?? `Request failed (${response.status})`);
    }
    return response.json() as Promise<T>;
  }
}
