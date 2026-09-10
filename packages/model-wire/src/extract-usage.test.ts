import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { extractFinalUsage } from "./extract-usage.js";

function sseChunks(payloads: unknown[]): AsyncIterable<Uint8Array> {
  const encoder = new TextEncoder();
  const lines = payloads.map((payload) => `data: ${typeof payload === "string" ? payload : JSON.stringify(payload)}\n`).join("");
  return (async function* () {
    yield encoder.encode(lines);
  })();
}

describe("extractFinalUsage", () => {
  test("openai: returns the real usage reported at the terminal chunk", async () => {
    const usage = await extractFinalUsage(
      "openai",
      sseChunks([{ choices: [{ delta: { content: "hi" }, finish_reason: null }] }, { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 7, completion_tokens: 1 } }, "[DONE]"]),
    );
    assert.deepEqual(usage, { inputTokens: 7, outputTokens: 1 });
  });

  test("anthropic: returns the real usage reported at message_delta, once message_stop confirms the stream really finished", async () => {
    const usage = await extractFinalUsage(
      "anthropic",
      sseChunks([
        { type: "message_start", message: { usage: { input_tokens: 4 } } },
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 6 } },
        { type: "message_stop" },
      ]),
    );
    assert.deepEqual(usage, { inputTokens: 4, outputTokens: 6 });
  });

  test("openai: a truncated stream (disconnected before [DONE]) returns undefined, not zero usage", async () => {
    const usage = await extractFinalUsage("openai", sseChunks([{ choices: [{ delta: { content: "partial" }, finish_reason: null }] }]));
    assert.equal(usage, undefined);
  });

  test("anthropic: a truncated stream (disconnected before message_stop) returns undefined, not partial usage", async () => {
    const usage = await extractFinalUsage(
      "anthropic",
      sseChunks([{ type: "message_start", message: { usage: { input_tokens: 4 } } }, { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 6 } }]),
    );
    assert.equal(usage, undefined);
  });
});
