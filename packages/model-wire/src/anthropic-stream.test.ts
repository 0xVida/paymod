import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { parseAnthropicStream } from "./anthropic-stream.js";
import type { ModelEvent } from "./types.js";

function payloadsOf(objects: unknown[]): AsyncIterable<string> {
  return (async function* () {
    for (const object of objects) yield JSON.stringify(object);
  })();
}

async function collect(payloads: AsyncIterable<string>): Promise<ModelEvent[]> {
  const out: ModelEvent[] = [];
  for await (const event of parseAnthropicStream(payloads)) out.push(event);
  return out;
}

describe("parseAnthropicStream", () => {
  test("streams text deltas and reports real usage at message_stop", async () => {
    const events = await collect(
      payloadsOf([
        { type: "message_start", message: { usage: { input_tokens: 10 } } },
        { type: "content_block_start", index: 0, content_block: { type: "text" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " there" } },
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } },
        { type: "message_stop" },
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

  test("reassembles a tool_use block streamed as partial JSON", async () => {
    const events = await collect(
      payloadsOf([
        { type: "message_start", message: { usage: { input_tokens: 5 } } },
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "call_1", name: "read_file" } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"path":' } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '"a.ts"}' } },
        { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 3 } },
        { type: "message_stop" },
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

  test("a stream that never reaches message_delta yields no message_stop", async () => {
    const events = await collect(payloadsOf([{ type: "message_start", message: { usage: { input_tokens: 5 } } }]));
    assert.equal(events.some((event) => event.type === "message_stop"), false);
  });
});
