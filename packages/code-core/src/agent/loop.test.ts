import test, { describe } from "node:test";
import assert from "node:assert/strict";
import type { ModelEvent, ModelProvider, ModelRequest, ModelResponse } from "../model/types.js";
import { FakeHost } from "../testing/fake-host.js";
import { runAgentLoop } from "./loop.js";

function fakeProvider(responses: ModelResponse[], onRequest?: (request: ModelRequest) => void): ModelProvider {
  let call = 0;
  return {
    id: "fake",
    generate: () => Promise.reject(new Error("not used in this test")),
    async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
      onRequest?.(request);
      const response = responses[Math.min(call++, responses.length - 1)]!;
      yield { type: "message_stop", response };
    },
    estimateTokens: () => Promise.reject(new Error("not used in this test")),
  };
}

describe("runAgentLoop", () => {
  test("stops immediately on end_turn with no tool calls", async () => {
    const host = new FakeHost();
    const provider = fakeProvider([{ message: { role: "assistant", content: "Done." }, stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } }]);

    const { messages } = await runAgentLoop({ host, provider, model: "fake-model", messages: [{ role: "user", content: "hi" }] });

    assert.equal(messages.length, 2);
    assert.deepEqual(messages[1], { role: "assistant", content: "Done." });
  });

  test("dispatches a tool call, appends the tool result and continues the loop", async () => {
    const host = new FakeHost();
    host.files.set("/workspace/a.txt", "hello");
    const provider = fakeProvider([
      {
        message: { role: "assistant", content: null, toolCalls: [{ id: "call_1", name: "read_file", arguments: { path: "/workspace/a.txt" } }] },
        stopReason: "tool_use",
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      { message: { role: "assistant", content: "The file says hello." }, stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } },
    ]);

    const { messages } = await runAgentLoop({ host, provider, model: "fake-model", messages: [{ role: "user", content: "what's in a.txt?" }] });

    const toolMessage = messages.find((message) => message.role === "tool");
    assert.ok(toolMessage);
    assert.match(toolMessage.content, /hello/);
    assert.deepEqual(messages.at(-1), { role: "assistant", content: "The file says hello." });
  });

  test("an unapproved approval-tier tool call is denied without executing", async () => {
    const host = new FakeHost();
    host.approvalDecision = false;
    const provider = fakeProvider([
      {
        message: { role: "assistant", content: null, toolCalls: [{ id: "call_1", name: "run_command", arguments: { executable: "rm", args: ["-rf", "/"] } }] },
        stopReason: "tool_use",
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      { message: { role: "assistant", content: "Ok, I won't run that." }, stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } },
    ]);

    const { messages } = await runAgentLoop({ host, provider, model: "fake-model", messages: [{ role: "user", content: "delete everything" }] });

    const toolMessage = messages.find((message) => message.role === "tool");
    assert.match(toolMessage!.content, /APPROVAL_DENIED/);
  });

  test("apply_patch routes through reviewDiff before writing and honors a rejection", async () => {
    const host = new FakeHost();
    host.reviewDecision = { decision: "reject", reason: "not needed" };
    const provider = fakeProvider([
      {
        message: {
          role: "assistant",
          content: null,
          toolCalls: [{ id: "call_1", name: "apply_patch", arguments: { edits: [{ path: "/workspace/a.txt", content: "new content" }] } }],
        },
        stopReason: "tool_use",
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      { message: { role: "assistant", content: "Understood." }, stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } },
    ]);

    const { messages } = await runAgentLoop({ host, provider, model: "fake-model", messages: [{ role: "user", content: "make a change" }] });

    assert.equal(host.files.get("/workspace/a.txt"), undefined);
    const toolMessage = messages.find((message) => message.role === "tool");
    assert.match(toolMessage!.content, /rejected/);
  });

  test("threads one taskId through every model call in the turn, and the caller's sessionId through all of them", async () => {
    const host = new FakeHost();
    host.files.set("/workspace/a.txt", "hello");
    const seenRequests: ModelRequest[] = [];
    const provider = fakeProvider(
      [
        {
          message: { role: "assistant", content: null, toolCalls: [{ id: "call_1", name: "read_file", arguments: { path: "/workspace/a.txt" } }] },
          stopReason: "tool_use",
          usage: { inputTokens: 1, outputTokens: 1 },
        },
        { message: { role: "assistant", content: "The file says hello." }, stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } },
      ],
      (request) => seenRequests.push(request),
    );

    await runAgentLoop({ host, provider, model: "fake-model", messages: [{ role: "user", content: "what's in a.txt?" }], sessionId: "ses_abc" });

    assert.equal(seenRequests.length, 2, "the tool-use round trip means two model calls happened");
    assert.equal(seenRequests[0]!.sessionId, "ses_abc");
    assert.equal(seenRequests[1]!.sessionId, "ses_abc");
    assert.ok(seenRequests[0]!.taskId, "a taskId must be generated even when the caller supplies none");
    assert.equal(seenRequests[0]!.taskId, seenRequests[1]!.taskId, "both calls in the same turn must share one taskId");
  });

  test("two separate runAgentLoop calls (two turns) get two different taskIds", async () => {
    const host = new FakeHost();
    const seenTaskIds: (string | undefined)[] = [];
    const makeProvider = () => fakeProvider(
      [{ message: { role: "assistant", content: "Done." }, stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } }],
      (request) => seenTaskIds.push(request.taskId),
    );

    await runAgentLoop({ host, provider: makeProvider(), model: "fake-model", messages: [{ role: "user", content: "first turn" }] });
    await runAgentLoop({ host, provider: makeProvider(), model: "fake-model", messages: [{ role: "user", content: "second turn" }] });

    assert.equal(seenTaskIds.length, 2);
    assert.notEqual(seenTaskIds[0], seenTaskIds[1]);
  });

  test("an oversized tool result is capped in messages, but the event and the artifact store keep the full content", async () => {
    const host = new FakeHost();
    const bigFile = "x".repeat(20_000);
    host.files.set("/workspace/big.txt", bigFile);
    const provider = fakeProvider([
      {
        message: { role: "assistant", content: null, toolCalls: [{ id: "call_big", name: "read_file", arguments: { path: "/workspace/big.txt" } }] },
        stopReason: "tool_use",
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      { message: { role: "assistant", content: "Read it." }, stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } },
    ]);

    const { messages } = await runAgentLoop({ host, provider, model: "fake-model", messages: [{ role: "user", content: "what's in big.txt?" }] });

    const toolMessage = messages.find((message) => message.role === "tool");
    assert.ok(toolMessage);
    const cappedContent = (JSON.parse(toolMessage.content) as { data: string }).data;
    assert.ok(cappedContent.length < bigFile.length, "the message re-entering the model's context must be capped");
    assert.match(cappedContent, /get_artifact\(artifactId: "call_big"\)/);

    const emittedEvent = host.events.find((event) => event.type === "tool_result");
    assert.equal((emittedEvent as { data?: unknown }).data, bigFile, "the UI event must carry the full, uncapped content");

    const artifact = await host.readArtifact("call_big");
    assert.equal(artifact?.fullContent, bigFile, "the artifact store must carry the full, uncapped content");
  });

  test("get_artifact retrieves what an earlier turn's capping cut out", async () => {
    const host = new FakeHost();
    const bigFile = "y".repeat(20_000);
    host.files.set("/workspace/big.txt", bigFile);
    const provider = fakeProvider([
      {
        message: { role: "assistant", content: null, toolCalls: [{ id: "call_big", name: "read_file", arguments: { path: "/workspace/big.txt" } }] },
        stopReason: "tool_use",
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      {
        message: { role: "assistant", content: null, toolCalls: [{ id: "call_retrieve", name: "get_artifact", arguments: { artifactId: "call_big" } }] },
        stopReason: "tool_use",
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      { message: { role: "assistant", content: "Got the rest." }, stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } },
    ]);

    const { messages } = await runAgentLoop({ host, provider, model: "fake-model", messages: [{ role: "user", content: "get the rest of that file" }] });

    const retrieveResult = messages.filter((message) => message.role === "tool").find((message) => message.toolCallId === "call_retrieve");
    assert.ok(retrieveResult);
    const parsed = JSON.parse(retrieveResult.content) as { data: { content: string } };
    assert.equal(parsed.data.content, bigFile.slice(0, parsed.data.content.length));
    assert.ok(parsed.data.content.length > 0);
  });

  test("stops after maxIterations rather than looping forever", async () => {
    const host = new FakeHost();
    const provider = fakeProvider([
      {
        message: { role: "assistant", content: null, toolCalls: [{ id: "call_1", name: "git_status", arguments: {} }] },
        stopReason: "tool_use",
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ]);

    const { messages } = await runAgentLoop({ host, provider, model: "fake-model", messages: [{ role: "user", content: "loop forever" }], maxIterations: 3 });

    const toolMessages = messages.filter((message) => message.role === "tool");
    assert.equal(toolMessages.length, 3);
  });

  test("contextUsage is undefined for a model that isn't in the registry", async () => {
    const host = new FakeHost();
    const provider = fakeProvider([{ message: { role: "assistant", content: "Done." }, stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } }]);

    const result = await runAgentLoop({ host, provider, model: "fake-model", messages: [{ role: "user", content: "hi" }] });

    assert.equal(result.contextUsage, undefined);
  });

  test("contextUsage is computed once per turn via estimateTokens, for a real registered model", async () => {
    const host = new FakeHost();
    let estimateCalls = 0;
    const provider = fakeProvider([{ message: { role: "assistant", content: "Done." }, stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } }]);
    provider.estimateTokens = async () => {
      estimateCalls += 1;
      return 50_000;
    };

    const result = await runAgentLoop({ host, provider, model: "gpt-4o", messages: [{ role: "user", content: "hi" }] });

    assert.equal(estimateCalls, 1);
    assert.ok(result.contextUsage);
    assert.equal(result.contextUsage.usedTokens, 50_000);
    assert.equal(result.contextUsage.contextWindow, 128_000);
    assert.equal(result.contextUsage.ratio, 50_000 / (128_000 - 4_096 - 1_000));
    assert.equal(result.contextUsage.shouldCompact, false);
  });

  test("a tool-call turn still estimates only once at the end, not once per model call within the turn", async () => {
    const host = new FakeHost();
    host.files.set("/workspace/a.txt", "hello");
    let estimateCalls = 0;
    const provider = fakeProvider([
      {
        message: { role: "assistant", content: null, toolCalls: [{ id: "call_1", name: "read_file", arguments: { path: "/workspace/a.txt" } }] },
        stopReason: "tool_use",
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      { message: { role: "assistant", content: "The file says hello." }, stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } },
    ]);
    provider.estimateTokens = async () => {
      estimateCalls += 1;
      return 1_000;
    };

    await runAgentLoop({ host, provider, model: "gpt-4o", messages: [{ role: "user", content: "what's in a.txt?" }] });

    assert.equal(estimateCalls, 1);
  });

  test("contextUsage is undefined, not thrown, when estimateTokens itself fails", async () => {
    const host = new FakeHost();
    const provider = fakeProvider([{ message: { role: "assistant", content: "Done." }, stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } }]);
    provider.estimateTokens = async () => {
      throw new Error("count_tokens is down");
    };

    const result = await runAgentLoop({ host, provider, model: "gpt-4o", messages: [{ role: "user", content: "hi" }] });

    assert.equal(result.contextUsage, undefined);
  });

  // compaction is no longer runAgentLoop's concern - it only sees the request view a
  // caller already assembled, never the canonical transcript compaction needs. See
  // agent/session-turn.test.ts for the equivalent coverage against runSessionTurn.
  test("shouldCompact on the returned contextUsage is a real, present signal - runAgentLoop reports it but never acts on it itself", async () => {
    const host = new FakeHost();
    const bigHistory = Array.from({ length: 40 }, (_, i) => ({ role: "user" as const, content: `earlier message ${i} `.repeat(400) }));
    const provider = fakeProvider([{ message: { role: "assistant", content: "Done." }, stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } }]);
    provider.estimateTokens = async () => 100_000; // well over gpt-4o's 72% trigger ratio
    let generateCalled = false;
    provider.generate = async () => {
      generateCalled = true;
      throw new Error("runAgentLoop must never call generate() - that is compaction's own auxiliary call, out of scope for this function now");
    };

    const result = await runAgentLoop({ host, provider, model: "gpt-4o", messages: [...bigHistory, { role: "user", content: "one more thing" }] });

    assert.equal(result.contextUsage?.shouldCompact, true);
    assert.equal(generateCalled, false);
    assert.equal(host.compactionRecords.length, 0);
    assert.equal(result.messages.length, bigHistory.length + 2, "the returned history is exactly the request plus this turn's new message - untouched, uncompacted");
  });
});
