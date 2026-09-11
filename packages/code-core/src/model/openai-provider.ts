import { encoding_for_model, get_encoding, type TiktokenModel } from "tiktoken";
import { correlationHeaders, type ModelEvent, type ModelMessage, type ModelProvider, type ModelRequest, type ModelResponse, type ProviderConfig } from "./types.js";
import { describeProviderError } from "./parse-error-response.js";
import { bodyChunks, parseOpenAiStream, parseSseLines } from "@paymod/model-wire";

// OpenAI's documented chat-format overhead (the "How to count tokens with tiktoken"
// cookbook formula): each message costs 3 tokens for its role/separator wrapper, a
// `name` field costs 1 more, and the reply is primed with 3 trailing tokens.
const TOKENS_PER_MESSAGE = 3;
const TOKENS_PER_NAME = 1;
const REPLY_PRIMING_TOKENS = 3;

function getEncoding(model: string) {
  try {
    return encoding_for_model(model as TiktokenModel);
  } catch {
    // an unrecognized model id (a future model tiktoken doesn't know about
    // yet) - o200k_base is every current GPT-4o-and-later model's real
    // encoding, a far closer approximation than refusing to estimate at all.
    return get_encoding("o200k_base");
  }
}

type OpenAiToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type OpenAiMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
};

function toOpenAiMessages(messages: ModelMessage[]): OpenAiMessage[] {
  return messages.map((message) => {
    if (message.role === "tool") {
      return { role: "tool", content: message.content, tool_call_id: message.toolCallId };
    }
    if (message.role === "assistant") {
      return {
        role: "assistant",
        content: message.content,
        ...(message.toolCalls && {
          tool_calls: message.toolCalls.map((call) => ({
            id: call.id,
            type: "function" as const,
            function: { name: call.name, arguments: JSON.stringify(call.arguments) },
          })),
        }),
      };
    }
    return { role: message.role, content: message.content };
  });
}

/**
 * always a streaming body: `generate()` drives `stream()` to completion instead of a
 * separate non-streaming request (see `generate()`'s doc for why that never works
 * through Paymod's inference proxy).
 */
function buildBody(request: ModelRequest) {
  return {
    model: request.model,
    messages: toOpenAiMessages(request.messages),
    ...(request.tools && {
      tools: request.tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } })),
    }),
    // max_completion_tokens, not the deprecated max_tokens: o-series and
    // the gpt-5.6 family reject max_tokens outright ("Unsupported
    // parameter"), and OpenAI's own docs describe max_completion_tokens
    // as the general replacement, not a reasoning-model-only field - it
    // works across older models (gpt-4o included) too.
    ...(request.maxOutputTokens !== undefined && { max_completion_tokens: request.maxOutputTokens }),
    ...(request.temperature !== undefined && { temperature: request.temperature }),
    stream: true,
    // without this, OpenAI omits `usage` from streamed chunks and `parseOpenAiStream`
    // reports 0 tokens even on a real completion - harmless for the text, but it
    // silently zeroes the real charge for a BYOK-free call relayed through Paymod's proxy.
    stream_options: { include_usage: true },
  };
}

export class OpenAiProvider implements ModelProvider {
  readonly id = "openai";

  constructor(private readonly config: ProviderConfig) {}

  private headers(request: ModelRequest): Record<string, string> {
    return { "Content-Type": "application/json", Authorization: `Bearer ${this.config.apiKey}`, ...correlationHeaders(request) };
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
    throw new Error("OpenAI stream ended without a message_stop event");
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(request),
      body: JSON.stringify(buildBody(request)),
      ...(request.signal && { signal: request.signal }),
    });
    if (!response.ok) throw new Error(await describeProviderError("OpenAI", response));
    yield* parseOpenAiStream(parseSseLines(bodyChunks(response)));
  }

  /** fully offline - `tiktoken` runs the real BPE encoding locally, so this works identically for BYOK and Paymod-managed sessions alike, unlike Anthropic's estimateTokens (which needs a real API call). */
  async estimateTokens(request: Pick<ModelRequest, "model" | "messages" | "tools">): Promise<number> {
    const encoding = getEncoding(request.model);
    try {
      let total = REPLY_PRIMING_TOKENS;
      for (const message of toOpenAiMessages(request.messages)) {
        total += TOKENS_PER_MESSAGE;
        total += encoding.encode(message.role).length;
        if (message.content) total += encoding.encode(message.content).length;
        if (message.tool_call_id) total += TOKENS_PER_NAME + encoding.encode(message.tool_call_id).length;
        for (const call of message.tool_calls ?? []) {
          total += encoding.encode(call.function.name).length;
          total += encoding.encode(call.function.arguments).length;
        }
      }
      for (const tool of request.tools ?? []) {
        total += encoding.encode(JSON.stringify({ name: tool.name, description: tool.description, parameters: tool.parameters })).length;
      }
      return total;
    } finally {
      // tiktoken's encoding is backed by WASM memory - must be freed
      // explicitly, it isn't garbage-collected like a plain JS object.
      encoding.free();
    }
  }
}
