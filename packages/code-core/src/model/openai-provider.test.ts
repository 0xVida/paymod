import test, { describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { OpenAiProvider } from "./openai-provider.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function sseResponse(lines: string[]): Response {
  const body = lines.map((line) => `data: ${line}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

describe("OpenAiProvider.generate", () => {
  test("drives the streamed response to completion and returns a plain text message, no tool calls", async () => {
    globalThis.fetch = (async () =>
      sseResponse([
        JSON.stringify({ choices: [{ delta: { content: "Hello there." }, finish_reason: null }] }),
        JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 4 } }),
        "[DONE]",
      ])) as typeof fetch;

    const provider = new OpenAiProvider({ baseUrl: "https://api.openai.com/v1", apiKey: "test" });
    const response = await provider.generate({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] });

    assert.deepEqual(response.message, { role: "assistant", content: "Hello there." });
    assert.equal(response.stopReason, "end_turn");
    assert.deepEqual(response.usage, { inputTokens: 10, outputTokens: 4 });
  });

  test("translates a tool_calls response", async () => {
    globalThis.fetch = (async () =>
      sseResponse([
        JSON.stringify({
          choices: [
            { delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "read_file", arguments: "" } }] }, finish_reason: null },
          ],
        }),
        JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"path":"a.txt"}' } }] }, finish_reason: null }] }),
        JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 4 } }),
        "[DONE]",
      ])) as typeof fetch;

    const provider = new OpenAiProvider({ baseUrl: "https://api.openai.com/v1", apiKey: "test" });
    const response = await provider.generate({ model: "gpt-4o", messages: [{ role: "user", content: "read a.txt" }] });

    assert.equal(response.stopReason, "tool_use");
    assert.deepEqual(response.message.role === "assistant" ? response.message.toolCalls : undefined, [{ id: "call_1", name: "read_file", arguments: { path: "a.txt" } }]);
  });

  test("throws with the response body on a non-ok status", async () => {
    globalThis.fetch = (async () => new Response("invalid api key", { status: 401 })) as typeof fetch;
    const provider = new OpenAiProvider({ baseUrl: "https://api.openai.com/v1", apiKey: "bad" });
    await assert.rejects(() => provider.generate({ model: "gpt-4o", messages: [] }), /401/);
  });

  test("throws if the stream ends without a message_stop event", async () => {
    globalThis.fetch = (async () => sseResponse([JSON.stringify({ choices: [{ delta: { content: "partial" }, finish_reason: null }] })])) as typeof fetch;
    const provider = new OpenAiProvider({ baseUrl: "https://api.openai.com/v1", apiKey: "test" });
    await assert.rejects(() => provider.generate({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }), /message_stop/);
  });

  test("carries sessionId/taskId as correlation headers for Paymod's own usage metering, when present", async () => {
    let capturedHeaders: Record<string, string> | undefined;
    globalThis.fetch = (async (_url, init) => {
      capturedHeaders = (init as RequestInit).headers as Record<string, string>;
      return sseResponse([JSON.stringify({ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), "[DONE]"]);
    }) as typeof fetch;

    const provider = new OpenAiProvider({ baseUrl: "https://api.openai.com/v1", apiKey: "test" });
    await provider.generate({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }], sessionId: "ses_1", taskId: "task_1" });

    assert.equal(capturedHeaders?.["x-paymod-session-id"], "ses_1");
    assert.equal(capturedHeaders?.["x-paymod-task-id"], "task_1");
  });

  test("omits the correlation headers entirely when neither id is given, rather than sending them empty", async () => {
    let capturedHeaders: Record<string, string> | undefined;
    globalThis.fetch = (async (_url, init) => {
      capturedHeaders = (init as RequestInit).headers as Record<string, string>;
      return sseResponse([JSON.stringify({ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), "[DONE]"]);
    }) as typeof fetch;

    const provider = new OpenAiProvider({ baseUrl: "https://api.openai.com/v1", apiKey: "test" });
    await provider.generate({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] });

    assert.equal("x-paymod-session-id" in (capturedHeaders ?? {}), false);
    assert.equal("x-paymod-task-id" in (capturedHeaders ?? {}), false);
  });

  test("sends stream_options just like stream() does, since generate() drives the same streamed request", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url, init) => {
      capturedBody = JSON.parse((init as RequestInit).body as string);
      return sseResponse([JSON.stringify({ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), "[DONE]"]);
    }) as typeof fetch;

    const provider = new OpenAiProvider({ baseUrl: "https://api.openai.com/v1", apiKey: "test" });
    await provider.generate({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] });

    assert.deepEqual(capturedBody?.["stream_options"], { include_usage: true });
    assert.equal(capturedBody?.["stream"], true);
  });
});

describe("OpenAiProvider.stream", () => {
  test("accumulates text deltas and yields a final message_stop", async () => {
    globalThis.fetch = (async () =>
      sseResponse([
        JSON.stringify({ choices: [{ delta: { content: "Hel" }, finish_reason: null }] }),
        JSON.stringify({ choices: [{ delta: { content: "lo." }, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 2 } }),
        "[DONE]",
      ])) as typeof fetch;

    const provider = new OpenAiProvider({ baseUrl: "https://api.openai.com/v1", apiKey: "test" });
    const events = [];
    for await (const event of provider.stream({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] })) events.push(event);

    const textDeltas = events.filter((event) => event.type === "text_delta").map((event) => (event as { delta: string }).delta);
    assert.deepEqual(textDeltas, ["Hel", "lo."]);

    const stop = events.at(-1);
    assert.equal(stop?.type, "message_stop");
    if (stop?.type === "message_stop") {
      assert.equal(stop.response.message.content, "Hello.");
      assert.equal(stop.response.stopReason, "end_turn");
    }
  });

  test("opts into stream usage reporting - OpenAI otherwise omits usage from every chunk, reporting 0/0 even on a real completion", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url, init) => {
      capturedBody = JSON.parse((init as RequestInit).body as string);
      return sseResponse([JSON.stringify({ choices: [{ delta: { content: "hi" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), "[DONE]"]);
    }) as typeof fetch;

    const provider = new OpenAiProvider({ baseUrl: "https://api.openai.com/v1", apiKey: "test" });
    for await (const _event of provider.stream({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] })) {
      // draining is enough to trigger the fetch
    }

    assert.deepEqual(capturedBody?.["stream_options"], { include_usage: true });
  });
});

describe("OpenAiProvider.estimateTokens", () => {
  const provider = new OpenAiProvider({ baseUrl: "https://api.openai.com/v1", apiKey: "test" });

  test("never touches the network - runs entirely offline against the real BPE encoding", async () => {
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      throw new Error("must not be called");
    }) as typeof fetch;

    await provider.estimateTokens({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] });
    assert.equal(fetchCalled, false);
  });

  test("counts more tokens for more content, not a constant", async () => {
    const short = await provider.estimateTokens({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] });
    const long = await provider.estimateTokens({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi ".repeat(500) }],
    });
    assert.ok(long > short, `expected a longer message to count more tokens (short=${short}, long=${long})`);
  });

  test("counts tool schemas toward the total", async () => {
    const withoutTools = await provider.estimateTokens({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] });
    const withTools = await provider.estimateTokens({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      tools: [{ name: "read_file", description: "Read the full contents of a file in the workspace.", parameters: { type: "object", properties: { path: { type: "string" } } } }],
    });
    assert.ok(withTools > withoutTools);
  });

  test("counts a real, known short phrase within a small, sane range - not wildly off", async () => {
    // "Hello, world!" is 4 tokens under o200k_base on its own; the message
    // wrapper overhead (role + per-message + priming) adds a small constant
    // on top, not anything close to doubling or halving that.
    const count = await provider.estimateTokens({ model: "gpt-4o", messages: [{ role: "user", content: "Hello, world!" }] });
    assert.ok(count >= 5 && count <= 15, `expected roughly 4 content tokens plus small overhead, got ${count}`);
  });

  test("falls back to o200k_base for an unrecognized model id rather than throwing", async () => {
    const count = await provider.estimateTokens({ model: "some-future-model-tiktoken-has-never-heard-of", messages: [{ role: "user", content: "hi" }] });
    assert.ok(count > 0);
  });
});
