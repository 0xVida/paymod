import test from "node:test";
import assert from "node:assert/strict";
import { X402Reconciler } from "./x402-reconciler.js";

test("x402 reconciler only records intents that were confirmed or safely retried", async () => {
  const calls: string[] = [];
  const prisma = {
    financialIntent: { findMany: async () => [{ id: "int_confirmed" }, { id: "int_retry" }, { id: "int_skip" }] },
  };
  const x402 = {
    reconcileUnknown: async (id: string) => {
      calls.push(id);
      return id === "int_skip" ? "SKIPPED" : id === "int_retry" ? "RETRIED" : "CONFIRMED";
    },
  };
  const reconciler = new X402Reconciler(prisma as never, x402 as never);

  assert.deepEqual(await reconciler.sweep(), ["int_confirmed", "int_retry"]);
  assert.deepEqual(calls, ["int_confirmed", "int_retry", "int_skip"]);
});
