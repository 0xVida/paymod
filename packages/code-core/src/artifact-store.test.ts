import test, { beforeEach, afterEach, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deleteSessionArtifacts, readArtifact, saveArtifact } from "./artifact-store.js";
import type { ToolArtifact } from "./host.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "code-core-artifacts-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function artifact(toolCallId: string, fullContent = "full content"): ToolArtifact {
  return { toolCallId, toolName: "read_file", createdAt: "2026-09-07T00:00:00.000Z", ok: true, fullContent };
}

describe("artifact-store", () => {
  test("round-trips an artifact to disk", async () => {
    await saveArtifact(dir, "session-a", artifact("tc_1"));
    const loaded = await readArtifact(dir, "session-a", "tc_1");
    assert.deepEqual(loaded, artifact("tc_1"));
  });

  test("returns undefined for an artifact that was never written", async () => {
    assert.equal(await readArtifact(dir, "session-a", "missing"), undefined);
  });

  test("artifacts are scoped per session - same toolCallId in two sessions doesn't collide", async () => {
    await saveArtifact(dir, "session-a", artifact("tc_1", "session a's content"));
    await saveArtifact(dir, "session-b", artifact("tc_1", "session b's content"));
    assert.equal((await readArtifact(dir, "session-a", "tc_1"))?.fullContent, "session a's content");
    assert.equal((await readArtifact(dir, "session-b", "tc_1"))?.fullContent, "session b's content");
  });

  test("deleteSessionArtifacts removes exactly one session's artifacts and leaves others untouched", async () => {
    await saveArtifact(dir, "session-a", artifact("tc_1"));
    await saveArtifact(dir, "session-a", artifact("tc_2"));
    await saveArtifact(dir, "session-b", artifact("tc_1"));

    await deleteSessionArtifacts(dir, "session-a");

    assert.equal(await readArtifact(dir, "session-a", "tc_1"), undefined);
    assert.equal(await readArtifact(dir, "session-a", "tc_2"), undefined);
    assert.notEqual(await readArtifact(dir, "session-b", "tc_1"), undefined);
  });

  test("deleteSessionArtifacts on a session with no artifacts is a no-op, not an error", async () => {
    await deleteSessionArtifacts(dir, "never-existed");
  });
});
