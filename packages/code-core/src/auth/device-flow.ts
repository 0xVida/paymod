import type { DeviceStartResponse, PaymodCodeClient } from "../api/paymod-code-client.js";

/** polls a started device auth request until the browser side approves, denies or it expires. */
export async function pollUntilResolved(client: PaymodCodeClient, start: DeviceStartResponse): Promise<string> {
  const deadline = Date.now() + start.expiresIn * 1000;

  while (Date.now() < deadline) {
    await sleep(start.interval * 1000);
    const result = await client.pollDeviceAuth(start.deviceCode);
    if (result.status === "approved") return result.credential;
    if (result.status === "denied") throw new Error("Sign-in was denied in the browser.");
    if (result.status === "expired") throw new Error("Sign-in code expired. Try again.");
  }

  throw new Error("Sign-in timed out. Try again.");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
