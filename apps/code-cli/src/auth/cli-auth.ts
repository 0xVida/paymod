import { PaymodCodeClient, pollUntilResolved } from "@paymod/code-core";
import { FileCredentialStore } from "./file-credential-store.js";

export function getApiUrl(): string {
  return process.env["PAYMOD_API_URL"] ?? "https://paymodapi-production.up.railway.app";
}

export function getWebUrl(): string {
  return process.env["PAYMOD_WEB_URL"] ?? "https://paymod.xyz";
}

/**
 * reuses `@paymod/code-core`'s device-code flow (`pollUntilResolved`,
 * shared with the extension) unchanged. extension and CLI logins end up
 * as separate `CodeCredential` rows against the same account, which the
 * existing many-to-one model already supports.
 */
export async function login(onPrompt: (message: string) => void): Promise<void> {
  const client = new PaymodCodeClient(getApiUrl());
  const start = await client.startDeviceAuth();
  const activateUrl = `${getWebUrl()}/dashboard/code/activate?user_code=${encodeURIComponent(start.userCode)}`;

  onPrompt(`Confirm code ${start.userCode} in your browser to finish signing in.`);
  onPrompt(`Opening ${activateUrl} ...`);
  try {
    const { default: open } = await import("open");
    await open(activateUrl);
  } catch {
    onPrompt("Couldn't open a browser automatically - open the URL above yourself.");
  }

  const credential = await pollUntilResolved(client, start);
  await new FileCredentialStore().set(credential);
}

export async function logout(): Promise<void> {
  await new FileCredentialStore().clear();
}

export async function getCredential(): Promise<string | undefined> {
  return new FileCredentialStore().get();
}
