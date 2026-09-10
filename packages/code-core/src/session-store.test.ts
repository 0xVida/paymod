import test, { beforeEach, afterEach, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { deleteSessionFile, listSessionFiles, readSessionFile, writeSessionFile, type StoredSession } from "./session-store.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "code-core-sessions-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function session(id: string, lastActivity: string): StoredSession {
  return { id, title: `Session ${id}`, project: "paymod", modelId: "gpt-4o", lastActivity, transcript: [{ id: randomUUID(), message: { role: "user", content: "hi" } }] };
}

describe("session-store", () => {
  test("round-trips a session to disk", async () => {
    const original = session("a", "2026-08-21T00:00:00.000Z");
    await writeSessionFile(dir, original);
    const loaded = await readSessionFile(dir, "a");
    assert.deepEqual(loaded, original);
  });

  test("migrates a legacy session file (messages, no transcript) by wrapping each message with a fresh id", async () => {
    const legacy = { id: "legacy-1", title: "Old session", project: "paymod", modelId: "gpt-4o", lastActivity: "2026-08-21T00:00:00.000Z", messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }] };
    await writeFile(join(dir, "legacy-1.json"), JSON.stringify(legacy), "utf8");

    const loaded = await readSessionFile(dir, "legacy-1");

    assert.ok(loaded);
    assert.equal(loaded.transcript.length, 2);
    assert.equal(loaded.transcript[0]!.message.content, "hi");
    assert.equal(loaded.transcript[1]!.message.content, "hello");
    assert.ok(loaded.transcript[0]!.id.length > 0);
    assert.notEqual(loaded.transcript[0]!.id, loaded.transcript[1]!.id);
    assert.equal((loaded as unknown as { messages?: unknown }).messages, undefined, "the legacy messages field must not survive into the migrated shape");
  });

  test("returns undefined for a session that was never written", async () => {
    assert.equal(await readSessionFile(dir, "missing"), undefined);
  });

  test("lists sessions newest-first by lastActivity", async () => {
    await writeSessionFile(dir, session("older", "2026-08-20T00:00:00.000Z"));
    await writeSessionFile(dir, session("newer", "2026-08-21T00:00:00.000Z"));
    const listed = await listSessionFiles(dir);
    assert.deepEqual(listed.map((s) => s.id), ["newer", "older"]);
  });

  test("delete removes the file, list no longer includes it", async () => {
    await writeSessionFile(dir, session("to-delete", "2026-08-21T00:00:00.000Z"));
    await deleteSessionFile(dir, "to-delete");
    assert.equal(await readSessionFile(dir, "to-delete"), undefined);
  });
});
