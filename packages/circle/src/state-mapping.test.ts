import test from "node:test";
import assert from "node:assert/strict";
import { mapCircleStateToOutcome, type CircleTransaction, type CircleTransactionState } from "./state-mapping.js";

function transaction(state: CircleTransactionState, overrides: Partial<CircleTransaction> = {}): CircleTransaction {
  return { state, updateDate: "2026-09-06T00:00:00.000Z", ...overrides };
}

test("CONFIRMED maps to CONFIRMED with the reported txHash", () => {
  const outcome = mapCircleStateToOutcome(transaction("CONFIRMED", { txHash: "0xabc" }), "1000000");
  assert.deepEqual(outcome, {
    status: "CONFIRMED",
    txRef: "0xabc",
    confirmedAt: new Date("2026-09-06T00:00:00.000Z"),
    actualAtomic: "1000000",
    alreadyExecuted: false,
  });
});

test("COMPLETE also maps to CONFIRMED", () => {
  const outcome = mapCircleStateToOutcome(transaction("COMPLETE", { txHash: "0xdef" }), "500");
  assert.equal(outcome.status, "CONFIRMED");
});

test("CONFIRMED without a txHash is a programming error, not a valid outcome", () => {
  assert.throws(() => mapCircleStateToOutcome(transaction("CONFIRMED"), "1000000"));
});

test("FAILED maps to FAILED, proven non-execution", () => {
  const outcome = mapCircleStateToOutcome(transaction("FAILED", { errorReason: "INSUFFICIENT_FUNDS" }), "1000000");
  assert.equal(outcome.status, "FAILED");
  if (outcome.status === "FAILED") assert.equal(outcome.failureCode, "INSUFFICIENT_FUNDS");
});

test("DENIED maps to FAILED", () => {
  const outcome = mapCircleStateToOutcome(transaction("DENIED"), "1000000");
  assert.equal(outcome.status, "FAILED");
});

test("every non-terminal state maps to UNKNOWN, never FAILED or CONFIRMED", () => {
  const nonTerminal: CircleTransactionState[] = ["INITIATED", "CLEARED", "QUEUED", "SENT", "STUCK", "CANCELLED"];
  for (const state of nonTerminal) {
    const outcome = mapCircleStateToOutcome(transaction(state), "1000000");
    assert.equal(outcome.status, "UNKNOWN", `expected ${state} to map to UNKNOWN`);
  }
});
