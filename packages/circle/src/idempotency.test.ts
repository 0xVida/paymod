import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { circleIdempotencyKey } from "./idempotency.js";

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function fakePaymentIdHex(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}

test("the same payment id always derives the same idempotency key", () => {
  const paymentId = fakePaymentIdHex("int_01JQEXAMPLE");
  assert.equal(circleIdempotencyKey(paymentId), circleIdempotencyKey(paymentId));
});

test("different payment ids derive different idempotency keys", () => {
  assert.notEqual(
    circleIdempotencyKey(fakePaymentIdHex("int_a")),
    circleIdempotencyKey(fakePaymentIdHex("int_b")),
  );
});

test("the output is a structurally valid UUID v4", () => {
  const key = circleIdempotencyKey(fakePaymentIdHex("int_anything"));
  assert.match(key, UUID_V4_PATTERN);
});

test("the output is a valid UUID v4 across many distinct inputs", () => {
  for (let i = 0; i < 50; i++) {
    const key = circleIdempotencyKey(fakePaymentIdHex(`int_${i}`));
    assert.match(key, UUID_V4_PATTERN);
  }
});
