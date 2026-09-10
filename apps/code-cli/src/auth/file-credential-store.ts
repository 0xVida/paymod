import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const CONFIG_DIR = join(homedir(), ".config", "paymod-code");
const CREDENTIAL_FILE = join(CONFIG_DIR, "credentials.json");

type StoredCredentials = { credential?: string };

/**
 * V1 answer for the CLI - a `0600` file, not an OS keychain. a native
 * keyring binding is tracked in `docs/Paymod-code-build-plan.md` for
 * later - this ships as the honest fallback instead of blocking on it.
 * mirrors `apps/code-extension/src/auth/credential-store.ts`'s
 * `get`/`set`/`clear` interface so `AgentHost` needs no CLI-specific branching.
 */
export class FileCredentialStore {
  async get(): Promise<string | undefined> {
    try {
      const raw = await readFile(CREDENTIAL_FILE, "utf8");
      const parsed = JSON.parse(raw) as StoredCredentials;
      return parsed.credential;
    } catch {
      return undefined;
    }
  }

  async set(secret: string): Promise<void> {
    await mkdir(dirname(CREDENTIAL_FILE), { recursive: true, mode: 0o700 });
    await writeFile(CREDENTIAL_FILE, JSON.stringify({ credential: secret } satisfies StoredCredentials), { mode: 0o600 });
  }

  async clear(): Promise<void> {
    await rm(CREDENTIAL_FILE, { force: true });
  }
}
