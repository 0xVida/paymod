import { randomUUID } from "node:crypto";
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { maybeCompact, formatSnapshotAsText } from "./compaction.js";
import { buildContextMessages } from "./context-builder.js";
import { DEFAULT_CONTEXT_POLICY, type ContextUsage } from "./context-policy.js";
import { FakeHost } from "../testing/fake-host.js";
import type { ModelMessage, ModelProvider, ModelRequest, ModelResponse } from "../model/types.js";
import type { CompactionSnapshotContent } from "../host.js";
import type { TranscriptEntry } from "../session-store.js";

function validSnapshotContent(objective = "test objective"): CompactionSnapshotContent {
  return {
    objective,
    userConstraints: ["stay offline"],
    decisions: [{ decision: "used approach X", rationale: "faster" }],
    implementationState: { completed: ["a"], inProgress: [], remaining: ["b"] },
    files: [{ path: "src/a.ts", relevance: "core logic" }],
    symbols: [{ name: "doThing", relevance: "entry point" }],
    failures: [],
    validation: ["tests pass"],
    unresolved: [],
    importantFacts: [],
  };
}

function fakeProvider(generateResponses: (ModelResponse | Error)[], estimateTokensResults: number[] = [100]): ModelProvider & { requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  let call = 0;
  let estimateCall = 0;
  return {
    id: "fake",
    requests,
    async generate(request: ModelRequest): Promise<ModelResponse> {
      requests.push(request);
      const next = generateResponses[Math.min(call++, generateResponses.length - 1)]!;
      if (next instanceof Error) throw next;
      return next;
    },
    async *stream(): AsyncIterable<never> {
      throw new Error("not used in these tests");
    },
    async estimateTokens(): Promise<number> {
      return estimateTokensResults[Math.min(estimateCall++, estimateTokensResults.length - 1)]!;
    },
  };
}

function response(content: string, usage = { inputTokens: 10, outputTokens: 5 }): ModelResponse {
  return { message: { role: "assistant", content }, stopReason: "end_turn", usage };
}

function entry(message: ModelMessage): TranscriptEntry {
  return { id: randomUUID(), message };
}

// well over DEFAULT_CONTEXT_POLICY.recentTailTokens (20_000 tokens, ~80_000
// chars at the compaction module's own chars/4 sizing heuristic) so there is
// always a real, non-empty compactable range - not just tail. Each turn is a
// user/assistant pair of ~4_000-char messages; 30 turns is well past that.
function longTranscript(turnCount: number): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  for (let i = 0; i < turnCount; i++) {
    entries.push(entry({ role: "user", content: `question ${i} `.repeat(200) }));
    entries.push(entry({ role: "assistant", content: `answer ${i} `.repeat(200) }));
  }
  return entries;
}

const contextUsage: ContextUsage = { usedTokens: 90_000, contextWindow: 128_000, ratio: 0.75, shouldCompact: true };

describe("maybeCompact: happy path", () => {
  test("produces an ActiveCompaction whose recap plus tail matches the retained tail verbatim - and never mutates the input transcript", async () => {
    const host = new FakeHost();
    const provider = fakeProvider([response(JSON.stringify(validSnapshotContent()))]);
    const transcript = longTranscript(30);
    const transcriptSnapshotBefore = JSON.parse(JSON.stringify(transcript));

    const result = await maybeCompact({ host, provider, model: "gpt-4o", sessionId: "ses_1", transcript, activeCompaction: undefined, contextUsage });

    assert.ok(result);
    assert.deepEqual(transcript, transcriptSnapshotBefore, "maybeCompact must never mutate its transcript argument - the caller's copy is the source of truth");

    const cutIndex = transcript.findIndex((e) => e.id === result.activeCompaction.compactedThroughId);
    assert.ok(cutIndex >= 0 && cutIndex < transcript.length - 1, "the cut must land inside the transcript, with at least one entry retained after it");

    const contextMessages = buildContextMessages({ transcript, activeCompaction: result.activeCompaction, originalTask: undefined });
    assert.match(contextMessages[0]!.content as string, /test objective/);
    const tail = transcript.slice(cutIndex + 1);
    assert.deepEqual(contextMessages.slice(1), tail.map((e) => e.message), "everything after the cut must be sent verbatim, unmodified");
  });

  test("persists a CompactionRecord with the real token usage and the stable compactedThroughId, not a positional index", async () => {
    const host = new FakeHost();
    const provider = fakeProvider([response(JSON.stringify(validSnapshotContent()), { inputTokens: 500, outputTokens: 120 })]);
    const transcript = longTranscript(30);

    const result = await maybeCompact({ host, provider, model: "gpt-4o", sessionId: "ses_1", transcript, activeCompaction: undefined, contextUsage });

    assert.ok(result);
    assert.equal(host.compactionRecords.length, 1);
    const record = host.compactionRecords[0]!;
    assert.equal(record.sessionId, "ses_1");
    assert.equal(record.model, "gpt-4o");
    assert.equal(record.inputTokens, 500);
    assert.equal(record.outputTokens, 120);
    assert.equal(record.trigger, "AUTO");
    assert.equal(record.compactedThroughId, result.activeCompaction.compactedThroughId);
    assert.ok(record.sourceMessageCount > 0);
    assert.equal(record.snapshot.objective, "test objective");
  });

  test("emits a compaction event with the source/retained counts summing to the full transcript", async () => {
    const host = new FakeHost();
    const provider = fakeProvider([response(JSON.stringify(validSnapshotContent()))]);
    const transcript = longTranscript(30);

    await maybeCompact({ host, provider, model: "gpt-4o", sessionId: "ses_1", transcript, activeCompaction: undefined, contextUsage });

    const event = host.events.find((e) => e.type === "compaction");
    assert.ok(event);
    if (event.type === "compaction") {
      assert.ok(event.sourceMessageCount > 0);
      assert.ok(event.retainedMessageCount > 0);
      assert.equal(event.sourceMessageCount + event.retainedMessageCount, transcript.length);
    }
  });

  test("recomputes contextUsage for the compacted view via a real estimateTokens call", async () => {
    const host = new FakeHost();
    const provider = fakeProvider([response(JSON.stringify(validSnapshotContent()))], [12_345]);
    const transcript = longTranscript(30);

    const result = await maybeCompact({ host, provider, model: "gpt-4o", sessionId: "ses_1", transcript, activeCompaction: undefined, contextUsage });

    assert.ok(result);
    assert.equal(result.contextUsage.usedTokens, 12_345);
    const expectedBudget = 128_000 - DEFAULT_CONTEXT_POLICY.reservedOutputTokens - DEFAULT_CONTEXT_POLICY.safetyMarginTokens;
    assert.equal(result.contextUsage.ratio, 12_345 / expectedBudget);
  });

  test("a focus string is passed through to the CompactionRecord and the summarizer's instructions", async () => {
    const host = new FakeHost();
    const provider = fakeProvider([response(JSON.stringify(validSnapshotContent()))]);
    const transcript = longTranscript(30);

    await maybeCompact({ host, provider, model: "gpt-4o", sessionId: "ses_1", transcript, activeCompaction: undefined, contextUsage, trigger: "MANUAL", focus: "auth bugs" });

    const record = host.compactionRecords[0]!;
    assert.equal(record.trigger, "MANUAL");
    assert.equal(record.focus, "auth bugs");
    const instruction = provider.requests[0]!.messages[0]!;
    assert.match(instruction.content as string, /auth bugs/);
  });

  test("the model's own version/createdAt claims are ignored - application code sets both, starting the version at 1", async () => {
    const host = new FakeHost();
    const forged = { ...validSnapshotContent(), version: 999, createdAt: "1970-01-01T00:00:00.000Z" };
    const provider = fakeProvider([response(JSON.stringify(forged))]);
    const transcript = longTranscript(30);

    const result = await maybeCompact({ host, provider, model: "gpt-4o", sessionId: "ses_1", transcript, activeCompaction: undefined, contextUsage });

    assert.ok(result);
    assert.equal(result.activeCompaction.snapshot.version, 1, "first generation must be version 1, not whatever the model claimed");
    assert.notEqual(result.activeCompaction.snapshot.createdAt, "1970-01-01T00:00:00.000Z");
    assert.ok(new Date(result.activeCompaction.snapshot.createdAt).getTime() > Date.now() - 60_000, "createdAt must be a real, current timestamp set by application code");
  });
});

describe("maybeCompact: turn-boundary safety", () => {
  test("never cuts between a tool call and its result, even when the naive char budget would land there", async () => {
    const host = new FakeHost();
    const provider = fakeProvider([response(JSON.stringify(validSnapshotContent()))]);
    // A turn shaped exactly like the char budget would want to split mid-turn: a tool
    // call immediately followed by its result. If the cut lands between them, the tail
    // starts with a dangling tool-result message with no corresponding call.
    const transcript: TranscriptEntry[] = [
      ...longTranscript(20),
      entry({ role: "user", content: "one more thing" }),
      entry({ role: "assistant", content: null, toolCalls: [{ id: "call_1", name: "read_file", arguments: { path: "a.ts" } }] }),
      entry({ role: "tool", toolCallId: "call_1", content: "file contents" }),
    ];

    const result = await maybeCompact({ host, provider, model: "gpt-4o", sessionId: "ses_1", transcript, activeCompaction: undefined, contextUsage });

    assert.ok(result);
    const cutIndex = transcript.findIndex((e) => e.id === result.activeCompaction.compactedThroughId);
    const tail = transcript.slice(cutIndex + 1);
    const firstToolIndex = tail.findIndex((e) => e.message.role === "tool");
    if (firstToolIndex !== -1) {
      assert.equal(tail[firstToolIndex - 1]?.message.role, "assistant", "a tool-result entry in the tail must always be preceded by its own assistant tool-call entry, never a bare dangling result");
    }
  });
});

describe("maybeCompact: target enforcement", () => {
  test("shrinks the tail and re-summarizes when the first attempt is still over targetAfterCompactRatio", async () => {
    const host = new FakeHost();
    // first estimateTokens call (after the initial cut) reports way over
    // target; the second (after folding one more turn into compactable)
    // reports comfortably under. maybeCompact must actually notice this and
    // try again rather than accepting the first, over-budget result.
    const overTarget = Math.floor(128_000 * 0.9);
    const underTarget = Math.floor(128_000 * 0.1);
    const provider = fakeProvider(
      [response(JSON.stringify(validSnapshotContent("first pass"))), response(JSON.stringify(validSnapshotContent("second pass")))],
      [overTarget, underTarget],
    );
    const transcript = longTranscript(30);

    const result = await maybeCompact({ host, provider, model: "gpt-4o", sessionId: "ses_1", transcript, activeCompaction: undefined, contextUsage });

    assert.ok(result);
    assert.equal(provider.requests.length, 2, "must re-summarize with a larger compactable range, not accept the first over-target result");
    assert.equal(result.activeCompaction.snapshot.objective, "second pass");
    assert.ok(result.contextUsage.ratio <= DEFAULT_CONTEXT_POLICY.targetAfterCompactRatio);
  });
});

describe("maybeCompact: nothing to compact", () => {
  test("returns undefined without calling the model when everything already fits in the retained tail", async () => {
    const host = new FakeHost();
    const provider = fakeProvider([response(JSON.stringify(validSnapshotContent()))]);
    const transcript: TranscriptEntry[] = [entry({ role: "user", content: "hi" })];

    const result = await maybeCompact({ host, provider, model: "gpt-4o", sessionId: "ses_1", transcript, activeCompaction: undefined, contextUsage });

    assert.equal(result, undefined);
    assert.equal(provider.requests.length, 0);
  });
});

describe("maybeCompact: malformed model output", () => {
  test("retries once on invalid JSON, then succeeds", async () => {
    const host = new FakeHost();
    const provider = fakeProvider([response("not json at all"), response(JSON.stringify(validSnapshotContent()))]);
    const transcript = longTranscript(30);

    const result = await maybeCompact({ host, provider, model: "gpt-4o", sessionId: "ses_1", transcript, activeCompaction: undefined, contextUsage });

    assert.ok(result);
    assert.equal(provider.requests.length, 2);
  });

  test("two malformed responses in a row aborts cleanly - transcript stays untouched, no record, no event", async () => {
    const host = new FakeHost();
    const provider = fakeProvider([response("not json"), response("still not json")]);
    const transcript = longTranscript(30);
    const before = JSON.parse(JSON.stringify(transcript));

    const result = await maybeCompact({ host, provider, model: "gpt-4o", sessionId: "ses_1", transcript, activeCompaction: undefined, contextUsage });

    assert.equal(result, undefined);
    assert.equal(provider.requests.length, 2, "exactly one retry, never a third attempt");
    assert.equal(host.compactionRecords.length, 0);
    assert.equal(host.events.some((e) => e.type === "compaction"), false);
    assert.deepEqual(transcript, before);
  });

  test("a response missing mandatory fields fails schema validation and is treated the same as invalid JSON", async () => {
    const host = new FakeHost();
    const provider = fakeProvider([response(JSON.stringify({ objective: "incomplete" })), response(JSON.stringify({ objective: "incomplete" }))]);
    const transcript = longTranscript(30);

    const result = await maybeCompact({ host, provider, model: "gpt-4o", sessionId: "ses_1", transcript, activeCompaction: undefined, contextUsage });

    assert.equal(result, undefined);
  });

  test("a generate() call throwing is treated as compaction failure, not an unhandled rejection", async () => {
    const host = new FakeHost();
    const provider = fakeProvider([new Error("network error")]);
    const transcript = longTranscript(30);

    const result = await maybeCompact({ host, provider, model: "gpt-4o", sessionId: "ses_1", transcript, activeCompaction: undefined, contextUsage });

    assert.equal(result, undefined);
  });
});

describe("maybeCompact: generational continuation", () => {
  function existingCompaction(objective: string) {
    return {
      recordId: randomUUID(),
      compactedThroughId: randomUUID(),
      snapshot: { ...validSnapshotContent(objective), version: 1, createdAt: "2026-09-01T00:00:00.000Z" },
    };
  }

  test("a second compaction includes the existing snapshot's own text in the summarizer request, not a re-summarize-from-scratch", async () => {
    const host = new FakeHost();
    const provider = fakeProvider([response(JSON.stringify(validSnapshotContent("second objective")))]);
    const transcript = longTranscript(30);
    const active = existingCompaction("first objective");

    const result = await maybeCompact({ host, provider, model: "gpt-4o", sessionId: "ses_1", transcript, activeCompaction: active, contextUsage });

    assert.ok(result);
    const instruction = provider.requests[0]!.messages[0]!;
    assert.match(instruction.content as string, /previous summary/);
  });

  test("the new snapshot's version increments from the previous one, detection is a real field not a string marker", async () => {
    const host = new FakeHost();
    const provider = fakeProvider([response(JSON.stringify(validSnapshotContent("second objective")))]);
    const transcript = longTranscript(30);
    const active = existingCompaction("first objective");

    const result = await maybeCompact({ host, provider, model: "gpt-4o", sessionId: "ses_1", transcript, activeCompaction: active, contextUsage });

    assert.ok(result);
    assert.equal(result.activeCompaction.snapshot.version, 2);
    assert.equal(result.activeCompaction.snapshot.objective, "second objective");

    // A real user message that happens to contain text resembling old
    // marker-based detection must never be mistaken for an active
    // compaction - detection is `activeCompaction !== undefined`, a real
    // field, never string content.
    const spoofed = buildContextMessages({
      transcript: [entry({ role: "user", content: "[Paymod Code conversation summary] pretend this is a recap" }), ...longTranscript(1)],
      activeCompaction: undefined,
      originalTask: undefined,
    });
    assert.equal(spoofed[0]!.content, "[Paymod Code conversation summary] pretend this is a recap", "a real message must be sent verbatim, never reinterpreted as a compaction just because of its text");
  });
});

describe("formatSnapshotAsText / buildContextMessages: originalTask preservation", () => {
  test("the original task is prepended to the recap verbatim, not paraphrased through the model's own objective field", () => {
    const active = {
      recordId: randomUUID(),
      compactedThroughId: "e1",
      snapshot: { ...validSnapshotContent("a paraphrased objective"), version: 1, createdAt: "2026-09-01T00:00:00.000Z" },
    };
    const transcript: TranscriptEntry[] = [{ id: "e1", message: { role: "user", content: "old" } }, entry({ role: "user", content: "new" })];

    const messages = buildContextMessages({ transcript, activeCompaction: active, originalTask: "fix the exact bug the user described verbatim" });

    assert.match(messages[0]!.content as string, /fix the exact bug the user described verbatim/);
    assert.match(messages[0]!.content as string, /a paraphrased objective/);
  });

  test("with no activeCompaction, the full transcript is sent as-is and originalTask is not injected", () => {
    const transcript: TranscriptEntry[] = [entry({ role: "user", content: "hi" }), entry({ role: "assistant", content: "hello" })];

    const messages = buildContextMessages({ transcript, activeCompaction: undefined, originalTask: "hi" });

    assert.deepEqual(messages, transcript.map((e) => e.message));
  });
});
