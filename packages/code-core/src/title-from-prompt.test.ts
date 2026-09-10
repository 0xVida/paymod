import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { titleFromPrompt } from "./title-from-prompt.js";

describe("titleFromPrompt", () => {
  test("uses the prompt verbatim when it already fits", () => {
    assert.equal(titleFromPrompt("List out all files in Paymod"), "List out all files in Paymod");
  });

  test("trims surrounding whitespace and collapses internal line breaks", () => {
    assert.equal(titleFromPrompt("  fix   the\n\nnull check  "), "fix the null check");
  });

  test("truncates a long prompt with an ellipsis rather than cutting it off silently", () => {
    const prompt = "a".repeat(100);
    const result = titleFromPrompt(prompt);
    assert.equal(result.length, 60);
    assert.ok(result.endsWith("…"));
  });

  test("falls back to the default title for an empty or whitespace-only prompt", () => {
    assert.equal(titleFromPrompt(""), "New session");
    assert.equal(titleFromPrompt("   "), "New session");
  });
});
