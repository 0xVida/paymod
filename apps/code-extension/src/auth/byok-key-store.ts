import type { SecretStorage } from "vscode";

export type InferenceProvider = "openai" | "anthropic";

const KEY_PREFIX = "paymodCode.byok.";

/**
 * A user's own provider API key: OS-keychain-backed via VS Code's
 * `SecretStorage`, never `settings.json`, session JSON, logs or telemetry.
 * One key per provider. When set, `ChatPanel` routes that provider's
 * inference directly, bypassing Paymod's proxy and balance.
 */
export class ByokKeyStore {
  constructor(private readonly secrets: SecretStorage) {}

  get(provider: InferenceProvider): Thenable<string | undefined> {
    return this.secrets.get(KEY_PREFIX + provider);
  }

  set(provider: InferenceProvider, key: string): Thenable<void> {
    return this.secrets.store(KEY_PREFIX + provider, key);
  }

  clear(provider: InferenceProvider): Thenable<void> {
    return this.secrets.delete(KEY_PREFIX + provider);
  }
}
