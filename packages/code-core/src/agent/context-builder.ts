import type { ModelMessage } from "../model/types.js";
import type { ActiveCompaction, TranscriptEntry } from "../session-store.js";
import { formatSnapshotAsText } from "./compaction.js";

/**
 * builds the message array to send the model - a synthetic recap (regenerated from
 * `activeCompaction.snapshot`, never persisted as a transcript entry) plus the verbatim
 * tail after `compactedThroughId`, or the full transcript if no compaction is active.
 * `originalTask`, when set, is prepended so the user's first request survives verbatim
 * instead of only as whatever got paraphrased into `objective`.
 */
export function buildContextMessages(session: { transcript: TranscriptEntry[]; activeCompaction?: ActiveCompaction | undefined; originalTask?: string | undefined }): ModelMessage[] {
  if (!session.activeCompaction) return session.transcript.map((entry) => entry.message);

  const cutIndex = session.transcript.findIndex((entry) => entry.id === session.activeCompaction!.compactedThroughId);
  const tail = cutIndex === -1 ? session.transcript : session.transcript.slice(cutIndex + 1);

  const taskLine = session.originalTask ? `Original task, verbatim: ${session.originalTask}\n\n` : "";
  const recap: ModelMessage = {
    role: "user",
    content: `${taskLine}Summary of earlier conversation (compacted to free up context space):\n\n${formatSnapshotAsText(session.activeCompaction.snapshot)}`,
  };
  return [recap, ...tail.map((entry) => entry.message)];
}
