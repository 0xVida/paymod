import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ToolArtifact } from "./host.js";

/**
 * plain filesystem persistence, mirroring `session-store.ts`'s shape - only the root
 * directory differs per host. kept as a sibling of the sessions directory, not nested
 * inside it, so `listSessionFiles`'s flat `.json` glob is never affected by artifact files.
 */
export async function saveArtifact(dir: string, sessionId: string, artifact: ToolArtifact): Promise<void> {
  const sessionDir = join(dir, sessionId);
  await mkdir(sessionDir, { recursive: true });
  await writeFile(join(sessionDir, `${artifact.toolCallId}.json`), JSON.stringify(artifact, null, 2), "utf8");
}

export async function readArtifact(dir: string, sessionId: string, toolCallId: string): Promise<ToolArtifact | undefined> {
  try {
    const raw = await readFile(join(dir, sessionId, `${toolCallId}.json`), "utf8");
    return JSON.parse(raw) as ToolArtifact;
  } catch {
    return undefined;
  }
}

export async function deleteSessionArtifacts(dir: string, sessionId: string): Promise<void> {
  const sessionDir = join(dir, sessionId);
  const entries = await readdir(sessionDir).catch(() => [] as string[]);
  await Promise.all(entries.map((entry) => unlink(join(sessionDir, entry)).catch(() => undefined)));
}
