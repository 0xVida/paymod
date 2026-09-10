import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { parseOpenAiStream } from "./openai-stream.js";
import type { ModelEvent } from "./types.js";

function payloadsOf(objects: unknown[]): AsyncIterable<string> {
  return (async function* () {
    for (const object of objects) yield typeof object === "string" ? object : JSON.stringify(object);
  })();
}

async function collect(payloads: AsyncIterable<string>): Promise<ModelEvent[]> {
  const out: ModelEvent[] = [];
  for await (const event of parseOpenAiStream(payloads)) out.push(event);
  return out;
}

describe("parseOpenAiStream", () => {
  test("streams text deltas and reports real usage at message_stop", async () => {
    const events = await collect(
      payloadsOf([
        { choices: [{ delta: { content: "Hi" }, finish_reason: null }] },
        { choices: [{ delta: { content: " there" }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 2 } },
        "[DONE]",
      ]),
    );

    assert.deepEqual(events[0], { type: "text_delta", delta: "Hi" });
    assert.deepEqual(events[1], { type: "text_delta", delta: " there" });
    const stop = events[2];
    assert.equal(stop?.type, "message_stop");
    assert.deepEqual(stop, {
      type: "message_stop",
      response: { message: { role: "assistant", content: "Hi there" }, stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 2 } },
    });
  });

  test("reassembles a tool call streamed across multiple argument deltas", async () => {
    const events = await collect(
      payloadsOf([
        { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "read_file", arguments: "" } }] }, finish_reason: null }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"path":' } }] }, finish_reason: null }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"a.ts"}' } }] }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 5, completion_tokens: 3 } },
        "[DONE]",
      ]),
    );

    const stop = events.at(-1);
    assert.equal(stop?.type, "message_stop");
    assert.deepEqual(stop.response.message, {
      role: "assistant",
      content: null,
      toolCalls: [{ id: "call_1", name: "read_file", arguments: { path: "a.ts" } }],
    });
    assert.equal(stop.response.stopReason, "tool_use");
  });

  test("a stream that never reaches a terminal chunk yields no message_stop", async () => {
    const events = await collect(payloadsOf([{ choices: [{ delta: { content: "partial" }, finish_reason: null }] }]));
    assert.equal(events.some((event) => event.type === "message_stop"), false);
  });
});
