import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { contextUsageRatio, DEFAULT_CONTEXT_POLICY, shouldCompact, usableConversationBudget, type ContextPolicy } from "./context-policy.js";

describe("usableConversationBudget", () => {
  test("subtracts reserved output and safety margin from the raw context window", () => {
    const policy: ContextPolicy = { ...DEFAULT_CONTEXT_POLICY, reservedOutputTokens: 4_000, safetyMarginTokens: 1_000 };
    assert.equal(usableConversationBudget(200_000, policy), 195_000);
  });

  test("never goes negative for a tiny context window", () => {
    const policy: ContextPolicy = { ...DEFAULT_CONTEXT_POLICY, reservedOutputTokens: 4_000, safetyMarginTokens: 1_000 };
    assert.equal(usableConversationBudget(2_000, policy), 0);
  });
});

describe("contextUsageRatio", () => {
  test("computes usage as a fraction of the usable budget, not the raw context window", () => {
    const policy: ContextPolicy = { ...DEFAULT_CONTEXT_POLICY, reservedOutputTokens: 0, safetyMarginTokens: 0 };
    assert.equal(contextUsageRatio(50_000, 100_000, policy), 0.5);
  });

  test("returns 1 (fully used) rather than dividing by zero when the budget is exhausted", () => {
    const policy: ContextPolicy = { ...DEFAULT_CONTEXT_POLICY, reservedOutputTokens: 100_000, safetyMarginTokens: 0 };
    assert.equal(contextUsageRatio(1, 100_000, policy), 1);
  });

  test("can exceed 1 when usage has already overrun the usable budget", () => {
    const policy: ContextPolicy = { ...DEFAULT_CONTEXT_POLICY, reservedOutputTokens: 0, safetyMarginTokens: 0 };
    assert.equal(contextUsageRatio(150_000, 100_000, policy), 1.5);
  });
});

describe("shouldCompact", () => {
  test("false below the trigger ratio", () => {
    const policy: ContextPolicy = { ...DEFAULT_CONTEXT_POLICY, compactAtRatio: 0.72, reservedOutputTokens: 0, safetyMarginTokens: 0 };
    assert.equal(shouldCompact(70_000, 100_000, policy), false);
  });

  test("true at or above the trigger ratio", () => {
    const policy: ContextPolicy = { ...DEFAULT_CONTEXT_POLICY, compactAtRatio: 0.72, reservedOutputTokens: 0, safetyMarginTokens: 0 };
    assert.equal(shouldCompact(72_000, 100_000, policy), true);
    assert.equal(shouldCompact(90_000, 100_000, policy), true);
  });
});
