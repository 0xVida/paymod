import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ContextUsage, ModelMessage, RunSessionTurnResult, TranscriptEntry } from "@paymod/code-core";
import { createSession, latestSessionForProject, listSessionsForProject, persistTurn, renameSession, resumeSession } from "./session-runner.js";

function turnResult(messages: ModelMessage[], contextUsage: ContextUsage | undefined): RunSessionTurnResult {
  const transcript: TranscriptEntry[] = messages.map((message) => ({ id: randomUUID(), message }));
  return { transcript, activeCompaction: undefined, originalTask: messages[0]?.content as string | undefined, contextUsage };
}

/**
 * uses a real temp dir, not a mock - `listSessionsForProject` and
 * `latestSessionForProject` exist for the project-scoping filter, and a
 * mock would just restate that assertion instead of proving it.
 */

let sessionsDir: string;

beforeEach(async () => {
  sessionsDir = await mkdtemp(join(tmpdir(), "paymod-code-cli-test-"));
});

afterEach(async () => {
  await rm(sessionsDir, { recursive: true, force: true });
});

describe("listSessionsForProject / latestSessionForProject", () => {
  test("a session for a different project never shows up - the bug this exists to prevent, ported from the extension's own SessionRegistry fix", async () => {
    await createSession(sessionsDir, "/repo/a");
    await createSession(sessionsDir, "/repo/b");

    const forA = await listSessionsForProject(sessionsDir, "/repo/a");
    assert.equal(forA.length, 1);
    assert.equal(forA[0]!.project, "/repo/a");
  });

  test("latestSessionForProject returns the newest of several, scoped to the same project", async () => {
    const first = await createSession(sessionsDir, "/repo/a");
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await createSession(sessionsDir, "/repo/a");
    await createSession(sessionsDir, "/repo/b");

    const latest = await latestSessionForProject(sessionsDir, "/repo/a");
    assert.equal(latest?.id, second.id);
    assert.notEqual(latest?.id, first.id);
  });

  test("no sessions for an unseen project returns an empty list, not an error", async () => {
    await createSession(sessionsDir, "/repo/a");
    assert.deepEqual(await listSessionsForProject(sessionsDir, "/repo/never-seen"), []);
    assert.equal(await latestSessionForProject(sessionsDir, "/repo/never-seen"), undefined);
  });
});

describe("renameSession", () => {
  test("updates the title without touching the transcript or other fields", async () => {
    const session = await createSession(sessionsDir, "/repo/a");
    await persistTurn(sessionsDir, session.id, session.modelId, turnResult([{ role: "user", content: "hi" }], undefined));

    await renameSession(sessionsDir, session.id, "Fix the login bug");

    const reloaded = await resumeSession(sessionsDir, session.id);
    assert.equal(reloaded?.title, "Fix the login bug");
    assert.equal(reloaded?.transcript.length, 1);
  });

  test("renaming a session id that doesn't exist is a silent no-op, not a crash", async () => {
    await assert.doesNotReject(() => renameSession(sessionsDir, "does-not-exist", "New title"));
  });
});

describe("persistTurn", () => {
  test("preserves the title set by renameSession while updating the transcript", async () => {
    const session = await createSession(sessionsDir, "/repo/a");
    await renameSession(sessionsDir, session.id, "Custom title");

    await persistTurn(sessionsDir, session.id, session.modelId, turnResult([{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }], undefined));

    const reloaded = await resumeSession(sessionsDir, session.id);
    assert.equal(reloaded?.title, "Custom title");
    assert.equal(reloaded?.transcript.length, 2);
  });

  test("persists a real contextUsage reading", async () => {
    const session = await createSession(sessionsDir, "/repo/a");
    const contextUsage = { usedTokens: 50_000, contextWindow: 128_000, ratio: 0.4, shouldCompact: false };

    await persistTurn(sessionsDir, session.id, session.modelId, turnResult([{ role: "user", content: "hi" }], contextUsage));

    const reloaded = await resumeSession(sessionsDir, session.id);
    assert.deepEqual(reloaded?.contextUsage, contextUsage);
  });

  test("a turn with no contextUsage (estimate failed) preserves the last known reading rather than erasing it", async () => {
    const session = await createSession(sessionsDir, "/repo/a");
    const contextUsage = { usedTokens: 50_000, contextWindow: 128_000, ratio: 0.4, shouldCompact: false };
    await persistTurn(sessionsDir, session.id, session.modelId, turnResult([{ role: "user", content: "hi" }], contextUsage));

    await persistTurn(sessionsDir, session.id, session.modelId, turnResult([{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }], undefined));

    const reloaded = await resumeSession(sessionsDir, session.id);
    assert.deepEqual(reloaded?.contextUsage, contextUsage);
  });
});
