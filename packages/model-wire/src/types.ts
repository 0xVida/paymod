export type ModelMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls?: ModelToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export type ModelToolCall = { id: string; name: string; arguments: Record<string, unknown> };

export type ModelUsage = { inputTokens: number; outputTokens: number; cachedInputTokens?: number };

export type ModelResponse = {
  message: ModelMessage;
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "error";
  usage: ModelUsage;
};

export type ModelEvent =
  | { type: "text_delta"; delta: string }
  | { type: "tool_call_delta"; id: string; name?: string; argumentsDelta?: string }
  | { type: "message_stop"; response: ModelResponse };
