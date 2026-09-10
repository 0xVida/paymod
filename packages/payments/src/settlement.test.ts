import test from "node:test";
import assert from "node:assert/strict";
import { isSafeToRelease, isTerminal, type SettlementOutcome } from "./index.js";

/**
 * these lock down the one rule that separates a correct permission layer from a
 * double-spend: which settlement outcomes permit releasing a budget reservation.
 * If someone later "simplifies" the three-valued outcome into a boolean, these
 * fail first.
 */

const confirmed: SettlementOutcome = {
  status: "CONFIRMED",
  txRef: "abc",
  confirmedAt: new Date(),
  actualAtomic: "1000000",
  alreadyExecuted: false,
};

const alreadyExecuted: SettlementOutcome = { ...confirmed, alreadyExecuted: true };

const failed: SettlementOutcome = {
  status: "FAILED",
  failureCode: "PeriodLimitExceeded",
  failedAt: new Date(),
};

const unknown: SettlementOutcome = {
  status: "UNKNOWN",
  reason: "rpc timeout while polling",
  observedAt: new Date(),
};

test("only a proven failure permits releasing the reservation", () => {
  assert.equal(isSafeToRelease(failed), true);
  assert.equal(isSafeToRelease(confirmed), false);
  assert.equal(isSafeToRelease(alreadyExecuted), false);
});

test("an unknown outcome NEVER permits release", () => {
  // the payment may have landed. Releasing here lets a second payment claim the
  // same headroom while the first is still in the air.
  assert.equal(isSafeToRelease(unknown), false);
});

test("an unknown outcome is not terminal, so the reconciler keeps working it", () => {
  assert.equal(isTerminal(unknown), false);
  assert.equal(isTerminal(confirmed), true);
  assert.equal(isTerminal(failed), true);
});

test("already-executed is a success, not a failure", () => {
  // the chain confirming our own prior work. Committing rather than releasing is
  // what makes blind retry a safe reconciliation strategy.
  assert.equal(alreadyExecuted.status, "CONFIRMED");
  assert.equal(isSafeToRelease(alreadyExecuted), false);
});
