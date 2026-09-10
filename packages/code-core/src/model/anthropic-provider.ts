import { correlationHeaders, type ModelEvent, type ModelMessage, type ModelProvider, type ModelRequest, type ModelResponse, type ProviderConfig } from "./types.js";
import { describeProviderError } from "./parse-error-response.js";
import { bodyChunks, parseAnthropicStream, parseSseLines } from "@paymod/model-wire";

const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

type AnthropicMessage = { role: "user" | "assistant"; content: AnthropicContentBlock[] };

function splitSystemPrompt(messages: ModelMessage[]): { system: string | undefined; rest: ModelMessage[] } {
  const systemParts: string[] = [];
  const rest: ModelMessage[] = [];
  for (const message of messages) {
    if (message.role === "system") systemParts.push(message.content);
    else rest.push(message);
  }
  return { system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined, rest };
}

function toAnthropicMessages(messages: ModelMessage[]): AnthropicMessage[] {
  return messages.map((message): AnthropicMessage => {
    if (message.role === "tool") {
      return { role: "user", content: [{ type: "tool_result", tool_use_id: message.toolCallId, content: message.content }] };
    }
    if (message.role === "assistant") {
      const blocks: AnthropicContentBlock[] = [];
      if (message.content) blocks.push({ type: "text", text: message.content });
      for (const call of message.toolCalls ?? []) blocks.push({ type: "tool_use", id: call.id, name: call.name, input: call.arguments });
      return { role: "assistant", content: blocks };
    }
    return { role: "user", content: [{ type: "text", text: message.content }] };
  });
}

function toAnthropicTools(tools: ModelRequest["tools"]) {
  return tools?.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters }));
}

/**
 * always a streaming body: `generate()` drives `stream()` to completion instead of a
 * separate non-streaming request (see `generate()`'s doc for why that never works
 * through Paymod's inference proxy).
 */
function buildBody(request: ModelRequest) {
  const { system, rest } = splitSystemPrompt(request.messages);
  return {
    model: request.model,
    ...(system && { system }),
    messages: toAnthropicMessages(rest),
    ...(request.tools && { tools: toAnthropicTools(request.tools) }),
    max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    ...(request.temperature !== undefined && { temperature: request.temperature }),
    stream: true,
  };
}

export class AnthropicProvider implements ModelProvider {
  readonly id = "anthropic";

  constructor(private readonly config: ProviderConfig) {}

  private headers(request: ModelRequest): Record<string, string> {
    return { "Content-Type": "application/json", "x-api-key": this.config.apiKey, "anthropic-version": ANTHROPIC_VERSION, ...correlationHeaders(request) };
  }

  /**
   * Drives `stream()` to completion instead of making its own non-streaming request.
   * Paymod's inference proxy (`InferenceProxyService.meteredForward`) always forces
   * `stream: true` upstream since its metering tees the streamed bytes, so a
   * Paymod-managed call never gets a plain JSON response. Reusing `stream()`'s SSE
   * parsing works for both BYOK and Paymod-managed sessions alike.
   */
  async generate(request: ModelRequest): Promise<ModelResponse> {
    for await (const event of this.stream(request)) {
      if (event.type === "message_stop") return event.response;
    }
    throw new Error("Anthropic stream ended without a message_stop event");
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    const response = await fetch(`${this.config.baseUrl}/v1/messages`, {
      method: "POST",
      headers: this.headers(request),
      body: JSON.stringify(buildBody(request)),
      ...(request.signal && { signal: request.signal }),
    });
    if (!response.ok) throw new Error(await describeProviderError("Anthropic", response));
    yield* parseAnthropicStream(parseSseLines(bodyChunks(response)));
  }

  /**
   * `baseUrl` already routes correctly for both BYOK (straight to api.anthropic.com) and
   * Paymod-managed sessions (Paymod's proxy forwards this path server-side, unmetered -
   * see `inference-proxy.controller.ts`'s `count_tokens` route), so this method never
   * needs to know which mode it's in.
   */
  async estimateTokens(request: Pick<ModelRequest, "model" | "messages" | "tools">): Promise<number> {
    const { system, rest } = splitSystemPrompt(request.messages);
    const response = await fetch(`${this.config.baseUrl}/v1/messages/count_tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": this.config.apiKey, "anthropic-version": ANTHROPIC_VERSION },
      body: JSON.stringify({
        model: request.model,
        ...(system && { system }),
        messages: toAnthropicMessages(rest),
        ...(request.tools && { tools: toAnthropicTools(request.tools) }),
      }),
    });
    if (!response.ok) throw new Error(await describeProviderError("Anthropic", response));
    const body = (await response.json()) as { input_tokens: number };
    return body.input_tokens;
  }
}
