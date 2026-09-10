import test, { beforeEach, afterEach, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deleteSessionCompactionRecords, saveCompactionRecord } from "./compaction-store.js";
import type { CompactionRecord } from "./host.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "code-core-compactions-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function record(id: string): CompactionRecord {
  return {
    id,
    sessionId: "session-a",
    compactedThroughId: "entry-40",
    sourceMessageCount: 41,
    snapshot: {
      version: 1,
      createdAt: "2026-09-07T00:00:00.000Z",
      objective: "test",
      userConstraints: [],
      decisions: [],
      implementationState: { completed: [], inProgress: [], remaining: [] },
      files: [],
      symbols: [],
      failures: [],
      validation: [],
      unresolved: [],
      importantFacts: [],
    },
    model: "gpt-4o",
    inputTokens: 100,
    outputTokens: 50,
    trigger: "AUTO",
    createdAt: "2026-09-07T00:00:00.000Z",
  };
}

describe("compaction-store", () => {
  test("persists a record readable back as the same JSON", async () => {
    await saveCompactionRecord(dir, "session-a", record("rec_1"));
    const raw = await readFile(join(dir, "session-a", "rec_1.json"), "utf8");
    assert.deepEqual(JSON.parse(raw), record("rec_1"));
  });

  test("records are scoped per session directory", async () => {
    await saveCompactionRecord(dir, "session-a", record("rec_1"));
    await saveCompactionRecord(dir, "session-b", record("rec_1"));
    const sessionADir = await readdir(join(dir, "session-a"));
    const sessionBDir = await readdir(join(dir, "session-b"));
    assert.deepEqual(sessionADir, ["rec_1.json"]);
    assert.deepEqual(sessionBDir, ["rec_1.json"]);
  });

  test("deleteSessionCompactionRecords removes exactly one session's records and leaves others untouched", async () => {
    await saveCompactionRecord(dir, "session-a", record("rec_1"));
    await saveCompactionRecord(dir, "session-a", record("rec_2"));
    await saveCompactionRecord(dir, "session-b", record("rec_1"));

    await deleteSessionCompactionRecords(dir, "session-a");

    assert.deepEqual(await readdir(join(dir, "session-a")), []);
    assert.deepEqual(await readdir(join(dir, "session-b")), ["rec_1.json"]);
  });

  test("deleteSessionCompactionRecords on a session with no records is a no-op, not an error", async () => {
    await deleteSessionCompactionRecords(dir, "never-existed");
  });
});
