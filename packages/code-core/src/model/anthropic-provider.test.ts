import test, { describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { AnthropicProvider } from "./anthropic-provider.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function sseResponse(events: unknown[]): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

describe("AnthropicProvider.generate", () => {
  test("drives the streamed response to completion and returns a plain text message, no tool calls", async () => {
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = (async (_url, init) => {
      capturedBody = JSON.parse((init as RequestInit).body as string);
      return sseResponse([
        { type: "message_start", message: { usage: { input_tokens: 10 } } },
        { type: "content_block_start", index: 0, content_block: { type: "text" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello there." } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 4 } },
        { type: "message_stop" },
      ]);
    }) as typeof fetch;

    const provider = new AnthropicProvider({ baseUrl: "https://api.anthropic.com", apiKey: "test" });
    const response = await provider.generate({
      model: "claude-sonnet",
      messages: [{ role: "system", content: "You are helpful." }, { role: "user", content: "hi" }],
    });

    assert.equal(capturedBody["system"], "You are helpful.");
    assert.equal(capturedBody["stream"], true);
    assert.deepEqual(response.message, { role: "assistant", content: "Hello there." });
    assert.equal(response.stopReason, "end_turn");
    assert.deepEqual(response.usage, { inputTokens: 10, outputTokens: 4 });
  });

  test("translates a tool_use response and round-trips a tool result", async () => {
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = (async (_url, init) => {
      capturedBody = JSON.parse((init as RequestInit).body as string);
      return sseResponse([
        { type: "message_start", message: { usage: { input_tokens: 10 } } },
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "read_file" } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"path":"a.txt"}' } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 4 } },
        { type: "message_stop" },
      ]);
    }) as typeof fetch;

    const provider = new AnthropicProvider({ baseUrl: "https://api.anthropic.com", apiKey: "test" });
    const response = await provider.generate({
      model: "claude-sonnet",
      messages: [
        { role: "user", content: "read a.txt" },
        { role: "assistant", content: null, toolCalls: [{ id: "toolu_1", name: "read_file", arguments: { path: "a.txt" } }] },
        { role: "tool", toolCallId: "toolu_1", content: "hello" },
      ],
    });

    assert.equal(response.stopReason, "tool_use");
    assert.deepEqual(response.message.role === "assistant" ? response.message.toolCalls : undefined, [{ id: "toolu_1", name: "read_file", arguments: { path: "a.txt" } }]);
    const messages = capturedBody["messages"] as { role: string; content: unknown[] }[];
    assert.deepEqual(messages[1], { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "read_file", input: { path: "a.txt" } }] });
    assert.deepEqual(messages[2], { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "hello" }] });
  });

  test("throws if the stream ends without a message_stop event", async () => {
    globalThis.fetch = (async () =>
      sseResponse([
        { type: "content_block_start", index: 0, content_block: { type: "text" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "partial" } },
      ])) as typeof fetch;

    const provider = new AnthropicProvider({ baseUrl: "https://api.anthropic.com", apiKey: "test" });
    await assert.rejects(() => provider.generate({ model: "claude-sonnet", messages: [{ role: "user", content: "hi" }] }), /message_stop/);
  });
});

describe("AnthropicProvider.stream", () => {
  test("accumulates text deltas across content_block events and yields a final message_stop", async () => {
    globalThis.fetch = (async () =>
      sseResponse([
        { type: "message_start", message: { usage: { input_tokens: 5 } } },
        { type: "content_block_start", index: 0, content_block: { type: "text" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hel" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "lo." } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } },
        { type: "message_stop" },
      ])) as typeof fetch;

    const provider = new AnthropicProvider({ baseUrl: "https://api.anthropic.com", apiKey: "test" });
    const events = [];
    for await (const event of provider.stream({ model: "claude-sonnet", messages: [{ role: "user", content: "hi" }] })) events.push(event);

    const textDeltas = events.filter((event) => event.type === "text_delta").map((event) => (event as { delta: string }).delta);
    assert.deepEqual(textDeltas, ["Hel", "lo."]);

    const stop = events.at(-1);
    assert.equal(stop?.type, "message_stop");
    if (stop?.type === "message_stop") {
      assert.equal(stop.response.message.content, "Hello.");
      assert.equal(stop.response.stopReason, "end_turn");
      assert.deepEqual(stop.response.usage, { inputTokens: 5, outputTokens: 2 });
    }
  });
});

describe("AnthropicProvider.estimateTokens", () => {
  test("posts to /v1/messages/count_tokens with the system prompt split out, and returns the real count", async () => {
    let capturedUrl = "";
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = (async (url, init) => {
      capturedUrl = url as string;
      capturedBody = JSON.parse((init as RequestInit).body as string);
      return jsonResponse({ input_tokens: 2095 });
    }) as typeof fetch;

    const provider = new AnthropicProvider({ baseUrl: "https://api.anthropic.com", apiKey: "test" });
    const count = await provider.estimateTokens({
      model: "claude-sonnet",
      messages: [{ role: "system", content: "You are helpful." }, { role: "user", content: "hi" }],
    });

    assert.equal(capturedUrl, "https://api.anthropic.com/v1/messages/count_tokens");
    assert.equal(capturedBody["system"], "You are helpful.");
    assert.equal(capturedBody["stream"], undefined, "count_tokens is not a streaming request");
    assert.equal(capturedBody["max_tokens"], undefined, "count_tokens does not take max_tokens");
    assert.equal(count, 2095);
  });

  test("includes tool schemas in the counted request", async () => {
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = (async (_url, init) => {
      capturedBody = JSON.parse((init as RequestInit).body as string);
      return jsonResponse({ input_tokens: 42 });
    }) as typeof fetch;

    const provider = new AnthropicProvider({ baseUrl: "https://api.anthropic.com", apiKey: "test" });
    await provider.estimateTokens({
      model: "claude-sonnet",
      messages: [{ role: "user", content: "hi" }],
      tools: [{ name: "read_file", description: "Read a file", parameters: { type: "object" } }],
    });

    assert.deepEqual(capturedBody["tools"], [{ name: "read_file", description: "Read a file", input_schema: { type: "object" } }]);
  });

  test("routes through baseUrl unchanged - works against a proxy the same way generate/stream do", async () => {
    let capturedUrl = "";
    globalThis.fetch = (async (url) => {
      capturedUrl = url as string;
      return jsonResponse({ input_tokens: 1 });
    }) as typeof fetch;

    const provider = new AnthropicProvider({ baseUrl: "https://paymod.example/v1/code/inference/anthropic", apiKey: "pmcode_test" });
    await provider.estimateTokens({ model: "claude-sonnet", messages: [{ role: "user", content: "hi" }] });

    assert.equal(capturedUrl, "https://paymod.example/v1/code/inference/anthropic/v1/messages/count_tokens");
  });
});
