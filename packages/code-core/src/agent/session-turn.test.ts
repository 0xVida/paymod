import test, { describe } from "node:test";
import assert from "node:assert/strict";
import type { ModelEvent, ModelProvider, ModelRequest, ModelResponse } from "../model/types.js";
import { FakeHost } from "../testing/fake-host.js";
import { runSessionTurn, type SessionTurnState } from "./session-turn.js";

const VALID_SNAPSHOT_CONTENT = {
  objective: "compacted objective",
  userConstraints: [],
  decisions: [],
  implementationState: { completed: [], inProgress: [], remaining: [] },
  files: [],
  symbols: [],
  failures: [],
  validation: [],
  unresolved: [],
  importantFacts: [],
};

type FakeProviderOptions = {
  streamResponses: ModelResponse[];
  estimateTokensResults: number[];
  onStreamRequest?: (request: ModelRequest) => void;
  generateResult?: () => ModelResponse;
  streamShouldThrow?: () => Error | undefined;
};

function fakeProvider(options: FakeProviderOptions): ModelProvider & { streamCalls: number; generateCalls: number } {
  let streamCall = 0;
  let estimateCall = 0;
  const state = { streamCalls: 0, generateCalls: 0 };
  return {
    id: "fake",
    get streamCalls() {
      return state.streamCalls;
    },
    get generateCalls() {
      return state.generateCalls;
    },
    async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
      state.streamCalls++;
      options.onStreamRequest?.(request);
      const maybeError = options.streamShouldThrow?.();
      if (maybeError) throw maybeError;
      const response = options.streamResponses[Math.min(streamCall++, options.streamResponses.length - 1)]!;
      yield { type: "message_stop", response };
    },
    async generate(): Promise<ModelResponse> {
      state.generateCalls++;
      if (!options.generateResult) throw new Error("generate() not configured for this test");
      return options.generateResult();
    },
    async estimateTokens(): Promise<number> {
      return options.estimateTokensResults[Math.min(estimateCall++, options.estimateTokensResults.length - 1)]!;
    },
  };
}

function emptySession(): SessionTurnState {
  return { transcript: [], activeCompaction: undefined, originalTask: undefined };
}

describe("runSessionTurn: a normal turn", () => {
  test("appends the user message and the model's response to the transcript, each with a fresh stable id", async () => {
    const host = new FakeHost();
    const provider = fakeProvider({
      streamResponses: [{ message: { role: "assistant", content: "hi there" }, stopReason: "end_turn", usage: { inputTokens: 5, outputTokens: 3 } }],
      estimateTokensResults: [100],
    });

    const result = await runSessionTurn({
      host,
      provider,
      model: "gpt-4o",
      sessionId: "ses_1",
      systemPrompt: "You are helpful.",
      session: emptySession(),
      userMessage: "hello",
    });

    assert.equal(result.transcript.length, 2);
    assert.equal(result.transcript[0]!.message.content, "hello");
    assert.equal(result.transcript[1]!.message.content, "hi there");
    assert.notEqual(result.transcript[0]!.id, result.transcript[1]!.id);
    assert.equal(result.originalTask, "hello");
  });

  test("originalTask is set once on the first turn and never overwritten on later turns", async () => {
    const host = new FakeHost();
    const provider = fakeProvider({
      streamResponses: [{ message: { role: "assistant", content: "ok" }, stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } }],
      estimateTokensResults: [100],
    });
    const session: SessionTurnState = { transcript: [], activeCompaction: undefined, originalTask: "the real first task" };

    const result = await runSessionTurn({ host, provider, model: "gpt-4o", sessionId: "ses_1", systemPrompt: "sys", session, userMessage: "a follow-up message" });

    assert.equal(result.originalTask, "the real first task");
  });

  test("the system prompt is never part of the persisted transcript", async () => {
    const host = new FakeHost();
    const provider = fakeProvider({
      streamResponses: [{ message: { role: "assistant", content: "ok" }, stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } }],
      estimateTokensResults: [100],
    });

    const result = await runSessionTurn({ host, provider, model: "gpt-4o", sessionId: "ses_1", systemPrompt: "You are helpful.", session: emptySession(), userMessage: "hi" });

    assert.ok(result.transcript.every((entry) => entry.message.role !== "system"));
  });
});

describe("runSessionTurn: end-of-turn compaction", () => {
  test("a real context threshold crossed this turn triggers compaction, and the full raw transcript survives it - data is never destroyed", async () => {
    const host = new FakeHost();
    const provider = fakeProvider({
      streamResponses: [{ message: { role: "assistant", content: "Done." }, stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } }],
      // every call after the turn's own is estimateTokens for compaction's target check.
      estimateTokensResults: [100_000, 10_000],
      generateResult: () => ({ message: { role: "assistant", content: JSON.stringify(VALID_SNAPSHOT_CONTENT) }, stopReason: "end_turn", usage: { inputTokens: 200, outputTokens: 80 } }),
    });
    const bigHistory: SessionTurnState = {
      transcript: Array.from({ length: 40 }, (_, i) => ({ id: `entry-${i}`, message: { role: "user" as const, content: `earlier message ${i} `.repeat(400) } })),
      activeCompaction: undefined,
      originalTask: "the original task",
    };
    const rawTranscriptBefore = JSON.parse(JSON.stringify(bigHistory.transcript));

    const result = await runSessionTurn({ host, provider, model: "gpt-4o", sessionId: "ses_1", systemPrompt: "sys", session: bigHistory, userMessage: "one more thing" });

    assert.ok(result.activeCompaction, "a real threshold crossing must actually produce a compaction");
    assert.equal(host.compactionRecords.length, 1);
    assert.ok(host.events.some((event) => event.type === "compaction"));

    // the critical data-loss check: every original message is still
    // present in the returned transcript, verbatim, plus this turn's two
    // new ones - nothing before this ever got replaced or trimmed.
    const allOriginalStillPresent = rawTranscriptBefore.every((original: { id: string }) => result.transcript.some((entry) => entry.id === original.id));
    assert.ok(allOriginalStillPresent, "every message that existed before compaction must still be present in the returned transcript");
    assert.equal(result.transcript.length, bigHistory.transcript.length + 2);
  });

  test("no compaction happens when contextUsage never crosses the threshold", async () => {
    const host = new FakeHost();
    const provider = fakeProvider({
      streamResponses: [{ message: { role: "assistant", content: "ok" }, stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } }],
      estimateTokensResults: [100],
    });

    const result = await runSessionTurn({ host, provider, model: "gpt-4o", sessionId: "ses_1", systemPrompt: "sys", session: emptySession(), userMessage: "hi" });

    assert.equal(result.activeCompaction, undefined);
    assert.equal(host.compactionRecords.length, 0);
  });
});

describe("runSessionTurn: preflight compaction", () => {
  test("a shouldCompact reading carried over from the previous turn triggers compaction before this turn's request is even built", async () => {
    const host = new FakeHost();
    let sawSummarizerCallBeforeMainTurn = false;
    const provider = fakeProvider({
      streamResponses: [{ message: { role: "assistant", content: "Done." }, stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } }],
      estimateTokensResults: [10_000],
      generateResult: () => {
        sawSummarizerCallBeforeMainTurn = true;
        return { message: { role: "assistant", content: JSON.stringify(VALID_SNAPSHOT_CONTENT) }, stopReason: "end_turn", usage: { inputTokens: 200, outputTokens: 80 } };
      },
      onStreamRequest: () => {
        assert.ok(sawSummarizerCallBeforeMainTurn, "the preflight compaction must run before the main turn's own stream() call, not after");
      },
    });
    const session: SessionTurnState = {
      transcript: Array.from({ length: 40 }, (_, i) => ({ id: `entry-${i}`, message: { role: "user" as const, content: `msg ${i} `.repeat(400) } })),
      activeCompaction: undefined,
      originalTask: undefined,
    };

    const result = await runSessionTurn({
      host,
      provider,
      model: "gpt-4o",
      sessionId: "ses_1",
      systemPrompt: "sys",
      session,
      userMessage: "continue",
      lastContextUsage: { usedTokens: 100_000, contextWindow: 128_000, ratio: 0.9, shouldCompact: true },
    });

    assert.ok(result.activeCompaction);
    assert.equal(provider.generateCalls, 1, "preflight should compact exactly once, not also redundantly at end of turn given the low post-compaction estimate");
  });
});

describe("runSessionTurn: emergency retry on a provider context-limit error", () => {
  test("compacts and retries once when the provider itself refuses the request as too large", async () => {
    const host = new FakeHost();
    let attempt = 0;
    const provider = fakeProvider({
      streamResponses: [{ message: { role: "assistant", content: "Done after retry." }, stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } }],
      estimateTokensResults: [100],
      generateResult: () => ({ message: { role: "assistant", content: JSON.stringify(VALID_SNAPSHOT_CONTENT) }, stopReason: "end_turn", usage: { inputTokens: 200, outputTokens: 80 } }),
      streamShouldThrow: () => {
        attempt++;
        return attempt === 1 ? new Error("400 context_length_exceeded: this model's maximum context length is 128000 tokens") : undefined;
      },
    });
    const session: SessionTurnState = {
      transcript: Array.from({ length: 40 }, (_, i) => ({ id: `entry-${i}`, message: { role: "user" as const, content: `msg ${i} `.repeat(400) } })),
      activeCompaction: undefined,
      originalTask: undefined,
    };

    const result = await runSessionTurn({ host, provider, model: "gpt-4o", sessionId: "ses_1", systemPrompt: "sys", session, userMessage: "one more" });

    assert.ok(result.activeCompaction, "the emergency path must have compacted");
    assert.equal(provider.streamCalls, 2, "exactly one retry after the emergency compaction, not a silent loop");
    const lastMessage = result.transcript[result.transcript.length - 1];
    assert.equal(lastMessage!.message.content, "Done after retry.");
  });

  test("a non-context-limit error is never swallowed - it propagates as-is", async () => {
    const host = new FakeHost();
    const provider = fakeProvider({
      streamResponses: [],
      estimateTokensResults: [100],
      streamShouldThrow: () => new Error("network timeout"),
    });

    await assert.rejects(
      () => runSessionTurn({ host, provider, model: "gpt-4o", sessionId: "ses_1", systemPrompt: "sys", session: emptySession(), userMessage: "hi" }),
      /network timeout/,
    );
  });
});
