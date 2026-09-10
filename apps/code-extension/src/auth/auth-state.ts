import * as vscode from "vscode";
import { PaymodCodeClient, pollUntilResolved } from "@paymod/code-core";
import { CredentialStore } from "./credential-store.js";

function getWebUrl(): string {
  return vscode.workspace.getConfiguration("paymodCode").get<string>("webUrl", "https://paymod.xyz");
}

function getApiUrl(): string {
  return vscode.workspace.getConfiguration("paymodCode").get<string>("apiUrl", "https://paymodapi-production.up.railway.app");
}

/**
 * Device-code auth (RFC 8628-style, see
 * `apps/api/src/code/device-auth.service.ts`). The credential is stored via
 * VS Code's `SecretStorage` (OS-keychain-backed), never `settings.json` or
 * workspace state.
 */
export class AuthState {
  private signedIn = false;
  private readonly credentials: CredentialStore;
  private readonly emitter = new vscode.EventEmitter<boolean>();
  readonly onDidChange = this.emitter.event;

  constructor(secrets: vscode.SecretStorage) {
    this.credentials = new CredentialStore(secrets);
  }

  /** hydrates in-memory state from a previously stored credential. Call once, before the first render. */
  async initialize(): Promise<void> {
    this.signedIn = (await this.credentials.get()) !== undefined;
  }

  isSignedIn(): boolean {
    return this.signedIn;
  }

  getCredential(): Promise<string | undefined> {
    return Promise.resolve(this.credentials.get());
  }

  async signIn(): Promise<void> {
    const client = new PaymodCodeClient(getApiUrl());
    const start = await client.startDeviceAuth();

    const activateUrl = `${getWebUrl()}/dashboard/code/activate?user_code=${encodeURIComponent(start.userCode)}`;
    await vscode.env.openExternal(vscode.Uri.parse(activateUrl));
    void vscode.window.showInformationMessage(`Confirm code ${start.userCode} in your browser to finish signing in.`);

    try {
      const credential = await pollUntilResolved(client, start);
      await this.credentials.set(credential);
      this.signedIn = true;
      this.emitter.fire(this.signedIn);
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : "Sign-in failed.");
    }
  }

  signOut(): void {
    this.signedIn = false;
    void this.credentials.clear();
    this.emitter.fire(this.signedIn);
  }
}
