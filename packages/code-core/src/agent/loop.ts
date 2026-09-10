import { randomUUID } from "node:crypto";
import type { AgentHost, PendingAction } from "../host.js";
import type { ModelMessage, ModelProvider, ModelResponse, ModelToolCall } from "../model/types.js";
import { ALL_TOOLS, getTool, type ToolResult } from "./tools/index.js";
import { capToolResult } from "./tools/capping.js";
import { getModelDescriptor } from "../model/registry.js";
import { contextUsageRatio, DEFAULT_CONTEXT_POLICY, shouldCompact, type ContextPolicy, type ContextUsage } from "./context-policy.js";

const DEFAULT_MAX_ITERATIONS = 25;

export type AgentLoopOptions = {
  host: AgentHost;
  provider: ModelProvider;
  model: string;
  /** full history including the new user turn and the system prompt; the caller owns history assembly. */
  messages: ModelMessage[];
  maxIterations?: number;
  signal?: AbortSignal;
  /** the persisted Code session this turn belongs to - threaded into every model call's `ModelRequest.sessionId` for Paymod's own usage metering. Omit for a caller with no session concept (e.g. a one-off script); the proxy falls back to a random id per call rather than requiring one. */
  sessionId?: string;
  contextPolicy?: ContextPolicy;
};

export type AgentLoopResult = {
  messages: ModelMessage[];
  /**
   * `undefined` when the model isn't in `MODEL_REGISTRY` (no known `contextWindow`) or
   * the estimate call itself failed (e.g. a transient network error) - never thrown,
   * since a missing context reading shouldn't fail an otherwise-successful turn.
   */
  contextUsage: ContextUsage | undefined;
};

/**
 * gather context -> build request -> stream -> tool calls -> permission tier -> execute
 * or ask approval -> repeat until end_turn, cancellation or the max-iteration guard.
 * Host-agnostic: every side effect goes through `AgentHost`.
 *
 * Deliberately has no compaction logic: it only sees `options.messages`, the request
 * view the caller already assembled (see `agent/context-builder.ts`), never the
 * canonical transcript compaction needs. `session-turn.ts`'s `runSessionTurn`
 * orchestrates a real turn against a persisted session; call this directly only when
 * there's no transcript/compaction concept to honor (a script, a test).
 */
export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const messages = await runLoopIterations(options);
  const contextUsage = await computeContextUsage(options, messages);
  return { messages, contextUsage };
}

async function runLoopIterations(options: AgentLoopOptions): Promise<ModelMessage[]> {
  const { host, provider, model, maxIterations = DEFAULT_MAX_ITERATIONS, signal, sessionId } = options;
  const messages = [...options.messages];
  const toolSchemas = ALL_TOOLS.map((tool) => tool.schema);
  // one user turn, however many model calls it takes internally (tool use,
  // retries) - this is exactly the boundary PAYMOD_CODE_PLAN.md's task-cost
  // aggregation groups by, so it's generated once here, not per call.
  const taskId = randomUUID();

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    if (signal?.aborted) return messages;

    const response = await streamToCompletion(provider, { model, messages, tools: toolSchemas, ...(sessionId && { sessionId }), taskId, ...(signal && { signal }) }, host);
    messages.push(response.message);

    if (response.stopReason !== "tool_use") return messages;

    const toolCalls = response.message.role === "assistant" ? (response.message.toolCalls ?? []) : [];
    if (toolCalls.length === 0) return messages;

    for (const call of toolCalls) {
      if (signal?.aborted) return messages;
      const result = await executeToolCall(host, call, signal);
      // the event carries the full, uncapped result - capping only ever
      // applies to what re-enters the model's own context, never to what
      // the user sees in the chat/diff panel.
      host.emit({ type: "tool_result", toolCallId: call.id, ok: result.ok, summary: summarize(result), data: result.ok ? result.data : undefined });

      const { capped, fullContent } = capToolResult(call.name, call.id, result);
      await host.saveArtifact({ toolCallId: call.id, toolName: call.name, createdAt: new Date().toISOString(), ok: result.ok, fullContent });
      messages.push({ role: "tool", toolCallId: call.id, content: JSON.stringify(capped) });
    }
  }

  return messages;
}

/**
 * one real `estimateTokens` call per turn, against the turn's final
 * messages/tool schemas - not per loop iteration, since that would mean an
 * extra network round trip (Anthropic) on every internal tool-call hop
 * within a single turn for no benefit anyone can see before the turn ends.
 */
async function computeContextUsage(options: AgentLoopOptions, messages: ModelMessage[]): Promise<ContextUsage | undefined> {
  const descriptor = getModelDescriptor(options.model);
  if (!descriptor) return undefined;

  const toolSchemas = ALL_TOOLS.map((tool) => tool.schema);
  const usedTokens = await options.provider.estimateTokens({ model: options.model, messages, tools: toolSchemas }).catch(() => undefined);
  if (usedTokens === undefined) return undefined;

  const policy = options.contextPolicy ?? DEFAULT_CONTEXT_POLICY;
  return {
    usedTokens,
    contextWindow: descriptor.contextWindow,
    ratio: contextUsageRatio(usedTokens, descriptor.contextWindow, policy),
    shouldCompact: shouldCompact(usedTokens, descriptor.contextWindow, policy),
  };
}

async function streamToCompletion(
  provider: ModelProvider,
  request: Parameters<ModelProvider["stream"]>[0],
  host: AgentHost,
): Promise<ModelResponse> {
  for await (const event of provider.stream(request)) {
    host.emit(event);
    if (event.type === "message_stop") return event.response;
  }
  throw new Error("Model stream ended without a message_stop event");
}

async function executeToolCall(host: AgentHost, call: ModelToolCall, signal?: AbortSignal): Promise<ToolResult> {
  const tool = getTool(call.name);
  if (!tool) return { ok: false, code: "UNKNOWN_TOOL", message: `No such tool: ${call.name}` };

  host.emit({ type: "tool_call", toolCall: call });

  if (tool.tier !== "auto") {
    const action: PendingAction = { toolName: tool.schema.name, description: describeCall(call), toolCall: call };
    const approved = await host.requestApproval(action);
    if (!approved) return { ok: false, code: "APPROVAL_DENIED", message: "The user did not approve this action." };
  }

  return tool.execute(host, call.arguments, signal);
}

function describeCall(call: ModelToolCall): string {
  return `${call.name}(${JSON.stringify(call.arguments)})`;
}

function summarize(result: ToolResult): string {
  return result.ok ? "ok" : `${result.code}: ${result.message}`;
}
