import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AgentHost, CompactionRecord, CompactionSnapshot, CompactionSnapshotContent } from "../host.js";
import type { ModelMessage, ModelProvider } from "../model/types.js";
import type { ActiveCompaction, TranscriptEntry } from "../session-store.js";
import { contextUsageRatio, DEFAULT_CONTEXT_POLICY, shouldCompact, type ContextPolicy, type ContextUsage } from "./context-policy.js";

const MANDATORY_FIELDS = ["objective", "userConstraints", "decisions", "implementationState", "failures", "files", "validation"] as const;

/**
 * validates exactly `CompactionSnapshotContent` - semantic fields only. `version` and
 * `createdAt` are never part of what the model is asked for or validates here; see that
 * type's docblock for why an LLM's claim about those isn't trustworthy the way its summary is.
 */
const compactionSnapshotContentSchema = z.object({
  objective: z.string(),
  userConstraints: z.array(z.string()),
  decisions: z.array(z.object({ decision: z.string(), rationale: z.string().optional() })),
  implementationState: z.object({
    completed: z.array(z.string()),
    inProgress: z.array(z.string()),
    remaining: z.array(z.string()),
  }),
  files: z.array(z.object({ path: z.string(), relevance: z.string(), changes: z.string().optional() })),
  symbols: z.array(z.object({ name: z.string(), file: z.string().optional(), relevance: z.string() })),
  failures: z.array(z.object({ command: z.string().optional(), error: z.string(), status: z.enum(["OPEN", "RESOLVED"]) })),
  validation: z.array(z.string()),
  unresolved: z.array(z.string()),
  importantFacts: z.array(z.string()),
}) satisfies z.ZodType<CompactionSnapshotContent>;

const SNAPSHOT_SHAPE_EXAMPLE = JSON.stringify(
  {
    objective: "one sentence describing what the user is trying to accomplish",
    userConstraints: ["explicit limits or preferences the user stated"],
    decisions: [{ decision: "a choice that was made", rationale: "why, if stated" }],
    implementationState: { completed: ["..."], inProgress: ["..."], remaining: ["..."] },
    files: [{ path: "path/to/file.ts", relevance: "why this file matters", changes: "what changed, if anything" }],
    symbols: [{ name: "functionOrTypeName", file: "path/to/file.ts", relevance: "why it matters" }],
    failures: [{ command: "the command that failed, if any", error: "what went wrong", status: "OPEN" }],
    validation: ["tests run, checks passed, real verification performed"],
    unresolved: ["open questions or unfinished threads"],
    importantFacts: ["anything else worth preserving verbatim"],
  } satisfies CompactionSnapshotContent,
  null,
  2,
);

function buildInstructionMessage(focus: string | undefined, continuingFromExistingSummary: boolean): ModelMessage {
  const focusLine = focus
    ? `\n\nFocus: ${focus}. Use this to steer emphasis within the fields below - it is not permission to omit any of them.`
    : "";
  const continuationLine = continuingFromExistingSummary
    ? "\n\nThe first message below is a previous summary of even earlier conversation, not a real user message. Produce an updated summary that incorporates it together with everything newer - do not drop information from it just because it isn't repeated in the newer messages."
    : "";
  return {
    role: "system",
    content:
      "The conversation below is being compacted to free up context space. " +
      "Summarize it as a single JSON object matching this exact shape, and output ONLY that JSON object, nothing else, no markdown fences. " +
      "Do not include a version or createdAt field - those are not part of the schema.\n\n" +
      SNAPSHOT_SHAPE_EXAMPLE +
      `\n\nThese fields are mandatory and must always be populated (use an empty array or string if there is genuinely nothing to report, never omit the field): ${MANDATORY_FIELDS.join(", ")}.` +
      continuationLine +
      focusLine,
  };
}

const RETRY_INSTRUCTION = "That response was not valid JSON matching the required schema. Output ONLY the JSON object, nothing else, no markdown fences.";

function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (fenced?.[1] ?? raw).trim();
}

function tryParseSnapshotContent(raw: string | null): CompactionSnapshotContent | undefined {
  if (!raw) return undefined;
  let decoded: unknown;
  try {
    decoded = JSON.parse(extractJson(raw));
  } catch {
    return undefined;
  }
  const result = compactionSnapshotContentSchema.safeParse(decoded);
  return result.success ? result.data : undefined;
}

/** two attempts total: the model's first response, then one retry with an explicit correction if the first wasn't valid. Never a third - an LLM that can't produce valid JSON twice in a row isn't going to on a third try either. */
async function generateSnapshotContent(
  provider: ModelProvider,
  model: string,
  requestMessages: ModelMessage[],
  sessionId: string | undefined,
): Promise<{ content: CompactionSnapshotContent; inputTokens: number; outputTokens: number } | undefined> {
  let inputTokens = 0;
  let outputTokens = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await provider.generate({
      model,
      messages: requestMessages,
      ...(sessionId && { sessionId }),
      taskId: randomUUID(),
    });
    inputTokens += response.usage.inputTokens;
    outputTokens += response.usage.outputTokens;

    const raw = response.message.role === "assistant" ? response.message.content : null;
    const parsed = tryParseSnapshotContent(raw);
    if (parsed) return { content: parsed, inputTokens, outputTokens };

    requestMessages.push({ role: "assistant", content: raw ?? "" }, { role: "user", content: RETRY_INSTRUCTION });
  }
  return undefined;
}

export function formatSnapshotAsText(snapshot: CompactionSnapshotContent): string {
  const sections: string[] = [`Objective: ${snapshot.objective}`];
  if (snapshot.userConstraints.length) sections.push(`Constraints:\n${snapshot.userConstraints.map((c) => `- ${c}`).join("\n")}`);
  if (snapshot.decisions.length) {
    sections.push(`Decisions:\n${snapshot.decisions.map((d) => `- ${d.decision}${d.rationale ? ` (${d.rationale})` : ""}`).join("\n")}`);
  }
  sections.push(
    "Implementation state:\n" +
      `- Completed: ${snapshot.implementationState.completed.join(", ") || "none"}\n` +
      `- In progress: ${snapshot.implementationState.inProgress.join(", ") || "none"}\n` +
      `- Remaining: ${snapshot.implementationState.remaining.join(", ") || "none"}`,
  );
  if (snapshot.files.length) {
    sections.push(`Files:\n${snapshot.files.map((f) => `- ${f.path}: ${f.relevance}${f.changes ? ` (${f.changes})` : ""}`).join("\n")}`);
  }
  if (snapshot.symbols.length) {
    sections.push(`Symbols:\n${snapshot.symbols.map((s) => `- ${s.name}${s.file ? ` (${s.file})` : ""}: ${s.relevance}`).join("\n")}`);
  }
  if (snapshot.failures.length) {
    sections.push(`Failures:\n${snapshot.failures.map((f) => `- [${f.status}] ${f.command ? `${f.command}: ` : ""}${f.error}`).join("\n")}`);
  }
  if (snapshot.validation.length) sections.push(`Validation performed:\n${snapshot.validation.map((v) => `- ${v}`).join("\n")}`);
  if (snapshot.unresolved.length) sections.push(`Unresolved:\n${snapshot.unresolved.map((u) => `- ${u}`).join("\n")}`);
  if (snapshot.importantFacts.length) sections.push(`Other important facts:\n${snapshot.importantFacts.map((f) => `- ${f}`).join("\n")}`);
  return sections.join("\n\n");
}

/**
 * groups a transcript into complete turns: one user message through the next, with every
 * assistant/tool round-trip attached. A tool-call message and its result never end up in
 * different groups, so cutting at a group boundary is always safe; cutting mid-turn would
 * produce invalid provider history (a dangling call or a result with no call).
 */
function groupIntoTurns(transcript: TranscriptEntry[]): TranscriptEntry[][] {
  const turns: TranscriptEntry[][] = [];
  let current: TranscriptEntry[] = [];
  for (const entry of transcript) {
    if (entry.message.role === "user" && current.length > 0) {
      turns.push(current);
      current = [];
    }
    current.push(entry);
  }
  if (current.length > 0) turns.push(current);
  return turns;
}

function messageCharLength(message: ModelMessage): number {
  if (message.role === "assistant") return (message.content?.length ?? 0) + JSON.stringify(message.toolCalls ?? []).length;
  return message.content.length;
}

function turnCharLength(turn: TranscriptEntry[]): number {
  return turn.reduce((total, entry) => total + messageCharLength(entry.message), 0);
}

/**
 * A deliberately cheap chars/4 approximation: it only decides roughly where to cut the
 * tail, not whether to compact at all (the caller already ran the real `estimateTokens`-
 * backed `shouldCompact` check). Cuts only at turn boundaries (`groupIntoTurns`).
 */
function selectRetainedTailTurns(turns: TranscriptEntry[][], recentTailTokens: number): { compactable: TranscriptEntry[][]; tail: TranscriptEntry[][] } {
  const CHARS_PER_TOKEN_ESTIMATE = 4;
  const charBudget = recentTailTokens * CHARS_PER_TOKEN_ESTIMATE;
  let charCount = 0;
  let splitIndex = turns.length;
  for (let i = turns.length - 1; i >= 0; i--) {
    const chars = turnCharLength(turns[i]!);
    if (charCount + chars > charBudget && splitIndex < turns.length) break;
    charCount += chars;
    splitIndex = i;
  }
  return { compactable: turns.slice(0, splitIndex), tail: turns.slice(splitIndex) };
}

export type MaybeCompactParams = {
  host: AgentHost;
  provider: ModelProvider;
  model: string;
  sessionId: string | undefined;
  transcript: TranscriptEntry[];
  activeCompaction: ActiveCompaction | undefined;
  contextUsage: ContextUsage;
  policy?: ContextPolicy;
  trigger?: "AUTO" | "MANUAL";
  focus?: string;
};

export type MaybeCompactResult = { activeCompaction: ActiveCompaction; contextUsage: ContextUsage };

const MAX_EXPANSION_ATTEMPTS = 3;

/**
 * Generational, not continuous: if `activeCompaction` is already set, its `snapshot` is
 * fed back to the summarizer as prior context (via `buildInstructionMessage`'s
 * continuation line), so it updates the previous summary instead of starting over.
 *
 * Never throws. Anything going wrong here means "no compaction happened" (`undefined`);
 * the caller falls back to the uncompacted transcript and gets another chance next turn.
 * The transcript itself is never touched: this only returns a new `ActiveCompaction`
 * pointer. See `session-store.ts`'s `StoredSession` docblock for why that split matters.
 */
export async function maybeCompact(params: MaybeCompactParams): Promise<MaybeCompactResult | undefined> {
  const { host, provider, model, sessionId, transcript, activeCompaction, contextUsage, focus } = params;
  const policy = params.policy ?? DEFAULT_CONTEXT_POLICY;
  const trigger = params.trigger ?? "AUTO";

  const turns = groupIntoTurns(transcript);
  const { compactable: initialCompactable, tail: initialTail } = selectRetainedTailTurns(turns, policy.recentTailTokens);
  if (initialCompactable.length === 0) return undefined;

  let compactableTurns = initialCompactable;
  let tailTurns = initialTail;

  for (let attempt = 0; attempt <= MAX_EXPANSION_ATTEMPTS; attempt++) {
    const compactableEntries = compactableTurns.flat();
    const requestMessages: ModelMessage[] = [buildInstructionMessage(focus, activeCompaction !== undefined), ...compactableEntries.map((entry) => entry.message)];
    const generated = await generateSnapshotContent(provider, model, requestMessages, sessionId).catch(() => undefined);
    if (!generated) return undefined;

    const snapshot: CompactionSnapshot = {
      ...generated.content,
      version: (activeCompaction?.snapshot.version ?? 0) + 1,
      createdAt: new Date().toISOString(),
    };

    const lastCompactedEntry = compactableEntries[compactableEntries.length - 1];
    if (!lastCompactedEntry) return undefined;
    const newActiveCompaction: ActiveCompaction = { recordId: randomUUID(), compactedThroughId: lastCompactedEntry.id, snapshot };

    const tailEntries = tailTurns.flat();
    const recapMessage: ModelMessage = { role: "user", content: formatSnapshotAsText(snapshot) };
    const previewMessages = [recapMessage, ...tailEntries.map((entry) => entry.message)];

    const usedTokens = await provider.estimateTokens({ model, messages: previewMessages }).catch(() => undefined);
    const newContextUsage: ContextUsage =
      usedTokens !== undefined
        ? {
            usedTokens,
            contextWindow: contextUsage.contextWindow,
            ratio: contextUsageRatio(usedTokens, contextUsage.contextWindow, policy),
            shouldCompact: shouldCompact(usedTokens, contextUsage.contextWindow, policy),
          }
        : contextUsage;

    const underTarget = usedTokens === undefined || newContextUsage.ratio <= policy.targetAfterCompactRatio;
    const canShrinkFurther = tailTurns.length > 1 && attempt < MAX_EXPANSION_ATTEMPTS;
    if (underTarget || !canShrinkFurther) {
      const record: CompactionRecord = {
        id: newActiveCompaction.recordId,
        sessionId: sessionId ?? "",
        compactedThroughId: newActiveCompaction.compactedThroughId,
        sourceMessageCount: compactableEntries.length,
        snapshot,
        model,
        inputTokens: generated.inputTokens,
        outputTokens: generated.outputTokens,
        trigger,
        ...(focus !== undefined && { focus }),
        createdAt: snapshot.createdAt,
      };
      await host.saveCompactionRecord(record);
      host.emit({ type: "compaction", recordId: record.id, sourceMessageCount: compactableEntries.length, retainedMessageCount: tailEntries.length });
      return { activeCompaction: newActiveCompaction, contextUsage: newContextUsage };
    }

    // still over target: fold the earliest tail turn into the compactable range and
    // re-summarize next iteration. This is the backstop for when the coarse chars/4 split undershoots.
    const [nextTurn, ...restTail] = tailTurns;
    if (!nextTurn) break;
    compactableTurns = [...compactableTurns, nextTurn];
    tailTurns = restTail;
  }

  return undefined;
}
