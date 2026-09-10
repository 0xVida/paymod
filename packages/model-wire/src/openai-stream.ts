import type { ModelEvent, ModelMessage, ModelResponse, ModelToolCall } from "./types.js";

function toStopReason(finishReason: string | null | undefined): ModelResponse["stopReason"] {
  if (finishReason === "stop") return "end_turn";
  if (finishReason === "tool_calls") return "tool_use";
  if (finishReason === "length") return "max_tokens";
  return "error";
}

/**
 * parses OpenAI's chat-completions SSE payloads into normalized
 * `ModelEvent`s. Shared by the client-side `OpenAiProvider` and the
 * inference-proxy's usage metering, which parses the same bytes it
 * relays without a second request.
 *
 * Only yields `message_stop` if the stream reached OpenAI's own `[DONE]`
 * sentinel - a dropped connection ends the stream without it, and a
 * synthetic `message_stop` built from partial content would report a
 * truncated response as complete.
 */
export async function* parseOpenAiStream(payloads: AsyncIterable<string>): AsyncGenerator<ModelEvent> {
  let content = "";
  const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();
  let finishReason: string | null = null;
  let usage: ModelResponse["usage"] = { inputTokens: 0, outputTokens: 0 };
  let sawDone = false;

  for await (const payload of payloads) {
    if (payload === "[DONE]") {
      sawDone = true;
      break;
    }
    const chunk = JSON.parse(payload) as {
      choices: { delta: { content?: string; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason: string | null }[];
      usage?: { prompt_tokens: number; completion_tokens: number };
    };
    const choice = chunk.choices[0];
    if (choice?.delta.content) {
      content += choice.delta.content;
      yield { type: "text_delta", delta: choice.delta.content };
    }
    for (const delta of choice?.delta.tool_calls ?? []) {
      const existing = toolCalls.get(delta.index) ?? { id: delta.id ?? "", name: delta.function?.name ?? "", arguments: "" };
      if (delta.id) existing.id = delta.id;
      if (delta.function?.name) existing.name = delta.function.name;
      if (delta.function?.arguments) existing.arguments += delta.function.arguments;
      toolCalls.set(delta.index, existing);
      yield {
        type: "tool_call_delta",
        id: existing.id,
        ...(delta.function?.name !== undefined && { name: delta.function.name }),
        ...(delta.function?.arguments !== undefined && { argumentsDelta: delta.function.arguments }),
      };
    }
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    if (chunk.usage) usage = { inputTokens: chunk.usage.prompt_tokens, outputTokens: chunk.usage.completion_tokens };
  }

  if (!sawDone) return;

  const message: ModelMessage = {
    role: "assistant",
    content: content || null,
    ...(toolCalls.size > 0 && { toolCalls: [...toolCalls.values()].map((call): ModelToolCall => ({ id: call.id, name: call.name, arguments: JSON.parse(call.arguments || "{}") })) }),
  };
  yield { type: "message_stop", response: { message, stopReason: toStopReason(finishReason), usage } };
}
