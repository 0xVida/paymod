import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ModelMessage } from "./model/types.js";
import type { CompactionSnapshot } from "./host.js";
import type { Session } from "./host.js";

/** A stable id travels with a message for its entire life, independent of its position in `transcript` - positions shift across compactions, ids never do. */
export type TranscriptEntry = { id: string; message: ModelMessage };

/**
 * Points at the currently-active compaction, if any. `compactedThroughId` names the last
 * `TranscriptEntry` folded into `snapshot`; everything after it in `transcript` is the
 * verbatim tail still sent alongside it. Absent means no compaction has happened yet.
 */
export type ActiveCompaction = {
  recordId: string;
  compactedThroughId: string;
  snapshot: CompactionSnapshot;
};

/**
 * `transcript` is the canonical, append-only history: never trimmed, never overwritten
 * by a compaction. `activeCompaction` is a separate pointer describing how to build a
 * smaller view of it for the model; the raw messages a compaction summarizes away stay
 * on disk forever. This split exists so compacting a session can never destroy data -
 * see `agent/context-builder.ts` for how the two combine into what's sent to the model.
 */
export type StoredSession = Session & {
  transcript: TranscriptEntry[];
  activeCompaction?: ActiveCompaction | undefined;
  /** the first real user message of the session, verbatim, set once and never overwritten - carried alongside every compaction's own snapshot rather than trusting a model-written paraphrase to preserve it. */
  originalTask?: string | undefined;
};

/** legacy on-disk shape, before `transcript`/`activeCompaction` existed - every session persisted before this migration. */
type LegacyStoredSession = Session & { messages: ModelMessage[] };

function isLegacyShape(value: StoredSession | LegacyStoredSession): value is LegacyStoredSession {
  return !Array.isArray((value as StoredSession).transcript) && Array.isArray((value as LegacyStoredSession).messages);
}

/**
 * A legacy file has `messages: ModelMessage[]` and no `transcript`/ids. Migrating just
 * wraps each message with a freshly generated id; nothing before this migration ever
 * referenced one, so there's nothing to recover.
 */
function migrateLegacySession(legacy: LegacyStoredSession): StoredSession {
  const { messages, ...rest } = legacy;
  return { ...rest, transcript: messages.map((message) => ({ id: randomUUID(), message })) };
}

/**
 * Plain filesystem persistence, shared by every host so the persistence
 * logic isn't duplicated: only the root directory differs per host
 * (`context.globalStorageUri.fsPath` for the extension,
 * `~/.config/paymod-code/sessions/` for the CLI).
 */
export async function readSessionFile(dir: string, id: string): Promise<StoredSession | undefined> {
  try {
    const raw = await readFile(join(dir, `${id}.json`), "utf8");
    const parsed = JSON.parse(raw) as StoredSession | LegacyStoredSession;
    return isLegacyShape(parsed) ? migrateLegacySession(parsed) : parsed;
  } catch {
    return undefined;
  }
}

export async function writeSessionFile(dir: string, session: StoredSession): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${session.id}.json`), JSON.stringify(session, null, 2), "utf8");
}

export async function listSessionFiles(dir: string): Promise<StoredSession[]> {
  const entries = await readdir(dir).catch(() => [] as string[]);
  const sessions: StoredSession[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const session = await readSessionFile(dir, entry.slice(0, -".json".length));
    if (session) sessions.push(session);
  }
  return sessions.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
}

export async function deleteSessionFile(dir: string, id: string): Promise<void> {
  await unlink(join(dir, `${id}.json`)).catch(() => undefined);
}
