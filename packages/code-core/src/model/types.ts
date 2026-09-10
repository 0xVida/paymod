// the normalized "result of a model call" shapes are owned by `@paymod/model-wire`,
// shared with the backend's usage metering so both sides parse the same wire formats.
// Re-exported here so existing `@paymod/code-core` import sites keep working unchanged.
export type { ModelMessage, ModelToolCall, ModelUsage, ModelResponse, ModelEvent } from "@paymod/model-wire";
import type { ModelMessage, ModelResponse, ModelEvent } from "@paymod/model-wire";

export type JsonSchema = { type: string; properties?: Record<string, unknown>; required?: string[]; [key: string]: unknown };

export type ToolSchema = { name: string; description: string; parameters: JsonSchema };

export type ModelRequest = {
  model: string;
  messages: ModelMessage[];
  tools?: ToolSchema[];
  maxOutputTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  /**
   * Opaque correlation ids for Paymod's usage metering (`inference-proxy.controller.ts`):
   * `sessionId` names the persisted Code session, `taskId` names the one user turn
   * (`runAgentLoop` generates a fresh one per call, the boundary a "task" means for cost
   * aggregation). Meaningless but harmless to a real provider or a BYOK key.
   */
  sessionId?: string;
  taskId?: string;
};

/**
 * `baseUrl` and `apiKey` are what make BYOK and Paymod-managed inference the same
 * adapter: point `baseUrl` at the real provider with the user's key, or at Paymod's
 * inference proxy with a `pm_live_...` credential. The adapter never knows who's paying.
 */
export type ProviderConfig = { baseUrl: string; apiKey: string };

export interface ModelProvider {
  readonly id: string;
  generate(request: ModelRequest): Promise<ModelResponse>;
  stream(request: ModelRequest): AsyncIterable<ModelEvent>;
  /**
   * real, not estimated: OpenAI's `tiktoken` runs the exact same BPE encoding the API
   * uses; Anthropic calls the real `/v1/messages/count_tokens` endpoint (free, rate-limited
   * separately from Messages calls). Avoids bad budgeting from a heuristic - see the context compaction plan's Phase 2.
   */
  estimateTokens(request: Pick<ModelRequest, "model" | "messages" | "tools">): Promise<number>;
}

/** shared by both providers so a real provider request never has to know these headers exist for Paymod's own accounting - just merge this in alongside the auth headers. */
export function correlationHeaders(request: ModelRequest): Record<string, string> {
  return {
    ...(request.sessionId && { "x-paymod-session-id": request.sessionId }),
    ...(request.taskId && { "x-paymod-task-id": request.taskId }),
  };
}
