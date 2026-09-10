import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CompactionRecord } from "./host.js";

/**
 * plain filesystem persistence, mirroring `artifact-store.ts`'s shape - a sibling
 * directory of `SESSIONS_DIR`/`ARTIFACTS_DIR`. write-only from the agent loop's
 * perspective - nothing reads a record back programmatically (an active compaction is
 * detected from the recap message, not these files) - it's purely a debuggability trail.
 */
export async function saveCompactionRecord(dir: string, sessionId: string, record: CompactionRecord): Promise<void> {
  const sessionDir = join(dir, sessionId);
  await mkdir(sessionDir, { recursive: true });
  await writeFile(join(sessionDir, `${record.id}.json`), JSON.stringify(record, null, 2), "utf8");
}

export async function deleteSessionCompactionRecords(dir: string, sessionId: string): Promise<void> {
  const sessionDir = join(dir, sessionId);
  const entries = await readdir(sessionDir).catch(() => [] as string[]);
  await Promise.all(entries.map((entry) => unlink(join(sessionDir, entry)).catch(() => undefined)));
}
