import type { SecretStorage } from "vscode";

const CREDENTIAL_KEY = "paymodCode.credential";

/** OS-keychain-backed via VS Code's SecretStorage, never `settings.json` or workspace state. */
export class CredentialStore {
  constructor(private readonly secrets: SecretStorage) {}

  get(): Thenable<string | undefined> {
    return this.secrets.get(CREDENTIAL_KEY);
  }

  set(secret: string): Thenable<void> {
    return this.secrets.store(CREDENTIAL_KEY, secret);
  }

  clear(): Thenable<void> {
    return this.secrets.delete(CREDENTIAL_KEY);
  }
}
