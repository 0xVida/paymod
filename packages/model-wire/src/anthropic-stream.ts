import type { ModelEvent, ModelMessage, ModelResponse, ModelToolCall } from "./types.js";

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

function toStopReason(stopReason: string | null | undefined): ModelResponse["stopReason"] {
  if (stopReason === "end_turn" || stopReason === "stop_sequence") return "end_turn";
  if (stopReason === "tool_use") return "tool_use";
  if (stopReason === "max_tokens") return "max_tokens";
  return "error";
}

function contentBlocksToMessage(blocks: AnthropicContentBlock[]): ModelMessage {
  const text = blocks.filter((block): block is { type: "text"; text: string } => block.type === "text").map((block) => block.text).join("");
  const toolCalls: ModelToolCall[] = blocks
    .filter((block): block is { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } => block.type === "tool_use")
    .map((block) => ({ id: block.id, name: block.name, arguments: block.input }));

  return { role: "assistant", content: text || null, ...(toolCalls.length > 0 && { toolCalls }) };
}

/**
 * parses Anthropic's Messages SSE payloads into normalized `ModelEvent`s.
 * Shared by the client-side `AnthropicProvider` and the inference-proxy's
 * usage metering, which parses the same bytes it relays without a second
 * request.
 *
 * Only yields `message_stop` if Anthropic's own `message_stop` event
 * arrived - a dropped connection ends the stream without one, and a
 * synthetic `message_stop` built from partial content would report a
 * truncated response as complete.
 */
export async function* parseAnthropicStream(payloads: AsyncIterable<string>): AsyncGenerator<ModelEvent> {
  const blocks = new Map<number, { type: "text" | "tool_use"; id?: string; name?: string; text: string }>();
  let stopReason: string | null = null;
  let usage: ModelResponse["usage"] = { inputTokens: 0, outputTokens: 0 };
  let sawMessageStop = false;

  for await (const payload of payloads) {
    const event = JSON.parse(payload) as Record<string, unknown>;
    const type = event["type"] as string;

    if (type === "message_stop") {
      sawMessageStop = true;
      break;
    } else if (type === "message_start") {
      const startUsage = (event["message"] as { usage?: { input_tokens: number } })?.usage;
      if (startUsage) usage = { ...usage, inputTokens: startUsage.input_tokens };
    } else if (type === "content_block_start") {
      const index = event["index"] as number;
      const block = event["content_block"] as { type: "text" | "tool_use"; id?: string; name?: string };
      blocks.set(index, { type: block.type, ...(block.id !== undefined && { id: block.id }), ...(block.name !== undefined && { name: block.name }), text: "" });
    } else if (type === "content_block_delta") {
      const index = event["index"] as number;
      const delta = event["delta"] as { type: string; text?: string; partial_json?: string };
      const block = blocks.get(index);
      if (!block) continue;
      if (delta.type === "text_delta" && delta.text) {
        block.text += delta.text;
        yield { type: "text_delta", delta: delta.text };
      } else if (delta.type === "input_json_delta" && delta.partial_json !== undefined) {
        block.text += delta.partial_json;
        yield { type: "tool_call_delta", id: block.id ?? "", ...(block.name !== undefined && { name: block.name }), argumentsDelta: delta.partial_json };
      }
    } else if (type === "message_delta") {
      const delta = event["delta"] as { stop_reason?: string };
      const deltaUsage = event["usage"] as { output_tokens?: number } | undefined;
      if (delta.stop_reason) stopReason = delta.stop_reason;
      if (deltaUsage?.output_tokens !== undefined) usage = { ...usage, outputTokens: deltaUsage.output_tokens };
    }
  }

  if (!sawMessageStop) return;

  const message = contentBlocksToMessage(
    [...blocks.values()].map((block) =>
      block.type === "text"
        ? { type: "text" as const, text: block.text }
        : { type: "tool_use" as const, id: block.id ?? "", name: block.name ?? "", input: JSON.parse(block.text || "{}") },
    ),
  );
  yield { type: "message_stop", response: { message, stopReason: toStopReason(stopReason), usage } };
}
