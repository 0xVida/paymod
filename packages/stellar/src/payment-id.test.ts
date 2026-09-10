import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { derivePaymentId, derivePaymentIdHex } from "./payment-id.js";

test("the same intent id always derives the same payment id", () => {
  const a = derivePaymentIdHex("int_01JQEXAMPLE");
  const b = derivePaymentIdHex("int_01JQEXAMPLE");
  assert.equal(a, b);
});

test("different intent ids derive different payment ids", () => {
  assert.notEqual(derivePaymentIdHex("int_a"), derivePaymentIdHex("int_b"));
});

test("the payment id is exactly 32 bytes, as the contract's BytesN<32> requires", () => {
  assert.equal(derivePaymentId("int_anything").length, 32);
  assert.equal(derivePaymentIdHex("int_anything").length, 64);
});

test("the derivation is namespaced so a future v2 cannot silently collide with v1", () => {
  const id = "int_shared";
  const v1 = derivePaymentIdHex(id);
  // if the "paymod:v1:" prefix were ever dropped, this would equal v1.
  const unnamespaced = createHash("sha256").update(id).digest("hex");
  assert.notEqual(v1, unnamespaced);
});
