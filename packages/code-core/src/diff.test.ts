import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { compactDiffLines, diffLines } from "./diff.js";

describe("diffLines", () => {
  test("unchanged lines are context, not add/remove", () => {
    const result = diffLines("a\nb\nc", "a\nb\nc");
    assert.deepEqual(result, [
      { kind: "context", text: "a" },
      { kind: "context", text: "b" },
      { kind: "context", text: "c" },
    ]);
  });

  test("a single changed line in the middle only marks that line, not the whole file", () => {
    const result = diffLines("a\nb\nc", "a\nX\nc");
    assert.deepEqual(result, [
      { kind: "context", text: "a" },
      { kind: "remove", text: "b" },
      { kind: "add", text: "X" },
      { kind: "context", text: "c" },
    ]);
  });

  test("a purely added line", () => {
    assert.deepEqual(diffLines("a\nb", "a\nb\nc"), [
      { kind: "context", text: "a" },
      { kind: "context", text: "b" },
      { kind: "add", text: "c" },
    ]);
  });

  test("a purely removed line", () => {
    assert.deepEqual(diffLines("a\nb\nc", "a\nc"), [
      { kind: "context", text: "a" },
      { kind: "remove", text: "b" },
      { kind: "context", text: "c" },
    ]);
  });

  test("an oversized file falls back to a full replace rather than hanging on the LCS table", () => {
    const big = Array.from({ length: 1000 }, (_, i) => `line${i}`).join("\n");
    const result = diffLines(big, big + "\nextra");
    assert.ok(result.every((line) => line.kind !== "context"), "the size-guard path must not emit context lines");
  });
});

describe("compactDiffLines", () => {
  test("drops leading and trailing context entirely", () => {
    const result = compactDiffLines([
      { kind: "context", text: "before" },
      { kind: "remove", text: "old" },
      { kind: "add", text: "new" },
      { kind: "context", text: "after" },
    ]);
    assert.deepEqual(result, [
      { kind: "remove", text: "old" },
      { kind: "add", text: "new" },
    ]);
  });

  test("collapses a run of context between two change groups into one separator line", () => {
    const result = compactDiffLines([
      { kind: "remove", text: "a" },
      { kind: "context", text: "x" },
      { kind: "context", text: "y" },
      { kind: "add", text: "b" },
    ]);
    assert.deepEqual(result, [
      { kind: "remove", text: "a" },
      { kind: "context", text: "⋮" },
      { kind: "add", text: "b" },
    ]);
  });
});
