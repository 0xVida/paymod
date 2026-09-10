import test from "node:test";
import assert from "node:assert/strict";
import { isTerminalIntentStatus } from "./client.js";

test("terminal intent statuses are recognized", () => {
  for (const status of ["COMPLETED", "DENIED", "FAILED", "EXPIRED"]) {
    assert.equal(isTerminalIntentStatus(status), true, status);
  }
});

test("non-terminal intent statuses are not mistaken for terminal", () => {
  for (const status of ["PENDING", "AUTHORIZED", "PROCESSING", "WAITING_APPROVAL"]) {
    assert.equal(isTerminalIntentStatus(status), false, status);
  }
});
