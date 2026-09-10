import { homedir } from "node:os";
import { join } from "node:path";

/** `~/.config/paymod-code/sessions/` - the CLI's own root, distinct from the extension's VS Code `globalStorageUri` but using the exact same on-disk `StoredSession` JSON shape (`@paymod/code-core`'s `session-store.ts`). */
export const SESSIONS_DIR = join(homedir(), ".config", "paymod-code", "sessions");

/** sibling of `SESSIONS_DIR`, not nested inside it - keeps `listSessionFiles`'s flat `.json` glob over `SESSIONS_DIR` unaffected by artifact files (`@paymod/code-core`'s `artifact-store.ts`). */
export const ARTIFACTS_DIR = join(homedir(), ".config", "paymod-code", "artifacts");

/** sibling of `SESSIONS_DIR`/`ARTIFACTS_DIR`, same reasoning - `@paymod/code-core`'s `compaction-store.ts`. */
export const COMPACTION_RECORDS_DIR = join(homedir(), ".config", "paymod-code", "compactions");
