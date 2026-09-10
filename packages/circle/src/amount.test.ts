import test from "node:test";
import assert from "node:assert/strict";
import { fromAtomicUsdc, toAtomicUsdc } from "./amount.js";

test("fromAtomicUsdc converts atomic units to a decimal string", () => {
  assert.equal(fromAtomicUsdc("1500000"), "1.5");
  assert.equal(fromAtomicUsdc("1000000"), "1");
  assert.equal(fromAtomicUsdc("1"), "0.000001");
  assert.equal(fromAtomicUsdc("0"), "0");
});

test("toAtomicUsdc converts a decimal string to atomic units", () => {
  assert.equal(toAtomicUsdc("1.5"), "1500000");
  assert.equal(toAtomicUsdc("1"), "1000000");
  assert.equal(toAtomicUsdc("0.000001"), "1");
  assert.equal(toAtomicUsdc("0"), "0");
});

test("toAtomicUsdc rejects more precision than USDC supports", () => {
  assert.throws(() => toAtomicUsdc("1.0000001"));
});

test("round-trips through both directions without drift", () => {
  for (const atomic of ["0", "1", "999999", "1000000", "123456789"]) {
    assert.equal(toAtomicUsdc(fromAtomicUsdc(atomic)), atomic);
  }
});
