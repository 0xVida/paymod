import { randomUUID } from "node:crypto";
import type { AgentHost } from "../host.js";
import type { ModelMessage, ModelProvider } from "../model/types.js";
import type { ActiveCompaction, TranscriptEntry } from "../session-store.js";
import { getModelDescriptor } from "../model/registry.js";
import { buildContextMessages } from "./context-builder.js";
import { maybeCompact } from "./compaction.js";
import { runAgentLoop, type AgentLoopOptions } from "./loop.js";
import { DEFAULT_CONTEXT_POLICY, type ContextPolicy, type ContextUsage } from "./context-policy.js";

export type SessionTurnState = {
  transcript: TranscriptEntry[];
  activeCompaction: ActiveCompaction | undefined;
  originalTask: string | undefined;
};

export type RunSessionTurnOptions = {
  host: AgentHost;
  provider: ModelProvider;
  model: string;
  sessionId: string;
  systemPrompt: string;
  session: SessionTurnState;
  userMessage: string;
  /** the previous turn's own `contextUsage` reading, if any - drives the preflight check below. Omit for a session's first turn. */
  lastContextUsage?: ContextUsage | undefined;
  maxIterations?: number;
  signal?: AbortSignal;
  contextPolicy?: ContextPolicy;
};

export type RunSessionTurnResult = SessionTurnState & { contextUsage: ContextUsage | undefined };

/**
 * best-effort text match against known provider context-limit errors (OpenAI's
 * `context_length_exceeded`, Anthropic's `prompt is too long`). Not exhaustive: this is
 * a last-resort backstop behind the preflight/end-of-turn checks, so a missed pattern
 * fails safely by propagating the error instead of silently eating it.
 */
const CONTEXT_LIMIT_ERROR_PATTERN = /context.{0,20}length|maximum context|too many tokens|context_length_exceeded|prompt is too long/i;

function isContextLimitError(error: unknown): boolean {
  return error instanceof Error && CONTEXT_LIMIT_ERROR_PATTERN.test(error.message);
}

/**
 * the one place that knows how to run a turn against a persisted session: assembles the
 * request view from the canonical transcript (`buildContextMessages`), drives the model
 * loop, and appends what actually happened back onto the real transcript, never the
 * compacted view that was sent. Decides whether to compact at three points:
 *
 * 1. Preflight, using the *previous* turn's `contextUsage` (no new `estimateTokens`
 *    call) - a reopened session or an unusually large prior turn can start this turn
 *    already over the line.
 * 2. End of turn, using this turn's real `contextUsage` (the common path).
 * 3. Emergency retry, only if the provider itself refuses the request as too large.
 *
 * `runAgentLoop` has no compaction logic of its own (see its docblock); this replaces
 * the compaction call that used to live inside it.
 */
export async function runSessionTurn(options: RunSessionTurnOptions): Promise<RunSessionTurnResult> {
  const policy = options.contextPolicy ?? DEFAULT_CONTEXT_POLICY;
  let { transcript, activeCompaction } = options.session;
  const originalTask = options.session.originalTask ?? options.userMessage;

  if (options.lastContextUsage?.shouldCompact) {
    const compacted = await tryCompact(options, transcript, activeCompaction, options.lastContextUsage, policy);
    if (compacted) activeCompaction = compacted;
  }

  const newUserEntry: TranscriptEntry = { id: randomUUID(), message: { role: "user", content: options.userMessage } };
  const systemMessage: ModelMessage = { role: "system", content: options.systemPrompt };
  const contextMessages = buildContextMessages({ transcript, activeCompaction, originalTask });
  const requestMessages: ModelMessage[] = [systemMessage, ...contextMessages, newUserEntry.message];

  const loopOptions: AgentLoopOptions = {
    host: options.host,
    provider: options.provider,
    model: options.model,
    messages: requestMessages,
    ...(options.maxIterations !== undefined && { maxIterations: options.maxIterations }),
    ...(options.signal && { signal: options.signal }),
    sessionId: options.sessionId,
    contextPolicy: policy,
  };

  let result;
  // tracks whichever request array actually produced `result` (original or the
  // emergency-compacted retry's shorter one). Slicing the delta below with the wrong
  // one silently corrupts the transcript instead of failing loudly.
  let sentMessages = requestMessages;
  try {
    result = await runAgentLoop(loopOptions);
  } catch (error) {
    if (!isContextLimitError(error)) throw error;

    const contextWindow = getModelDescriptor(options.model)?.contextWindow ?? Number.MAX_SAFE_INTEGER;
    const emergencyUsage: ContextUsage = { usedTokens: contextWindow, contextWindow, ratio: 1, shouldCompact: true };
    const transcriptWithNewMessage = [...transcript, newUserEntry];
    const compacted = await tryCompact(options, transcriptWithNewMessage, activeCompaction, emergencyUsage, policy);
    if (!compacted) throw error;

    activeCompaction = compacted;
    const retryContextMessages = buildContextMessages({ transcript: transcriptWithNewMessage, activeCompaction, originalTask });
    sentMessages = [systemMessage, ...retryContextMessages];
    result = await runAgentLoop({ ...loopOptions, messages: sentMessages });
  }

  // whatever the loop appended beyond the request view is this turn's new history;
  // append it to the real transcript, never the (possibly compacted) view that was sent.
  const newMessages = result.messages.slice(sentMessages.length);
  const newTranscript: TranscriptEntry[] = [...transcript, newUserEntry, ...newMessages.map((message) => ({ id: randomUUID(), message }))];

  let finalActiveCompaction = activeCompaction;
  if (result.contextUsage?.shouldCompact) {
    const compacted = await tryCompact(options, newTranscript, activeCompaction, result.contextUsage, policy);
    if (compacted) finalActiveCompaction = compacted;
  }

  return { transcript: newTranscript, activeCompaction: finalActiveCompaction, originalTask, contextUsage: result.contextUsage };
}

async function tryCompact(
  options: RunSessionTurnOptions,
  transcript: TranscriptEntry[],
  activeCompaction: ActiveCompaction | undefined,
  contextUsage: ContextUsage,
  policy: ContextPolicy,
): Promise<ActiveCompaction | undefined> {
  const compacted = await maybeCompact({
    host: options.host,
    provider: options.provider,
    model: options.model,
    sessionId: options.sessionId,
    transcript,
    activeCompaction,
    contextUsage,
    policy,
  });
  return compacted?.activeCompaction;
}
