import test from "node:test";
import assert from "node:assert/strict";
import {
  addAtomic,
  assertFitsI128,
  assertId,
  cmpAtomic,
  ERROR_CODES,
  formatAtomicAmount,
  isId,
  newId,
  parseAtomicAmount,
  PaymodError,
  subAtomic,
  timestampOf,
  ulid,
} from "./index.js";

// --- money -----------------------------------------------------------------

test("atomic amounts round-trip through 7-decimal USDC formatting", () => {
  assert.equal(formatAtomicAmount("2500000", 7), "0.25");
  assert.equal(formatAtomicAmount("10000000", 7), "1");
  assert.equal(formatAtomicAmount("0", 7), "0");
  assert.equal(formatAtomicAmount("1", 7), "0.0000001");
});

test("formatting respects the asset's own decimals rather than assuming 7", () => {
  // same integer, different asset conventions: Stellar USDC is 7dp, most EVM USDC is 6dp.
  assert.equal(formatAtomicAmount("1000000", 7), "0.1");
  assert.equal(formatAtomicAmount("1000000", 6), "1");
});

test("parsing rejects anything that is not a non-negative integer string", () => {
  for (const bad of ["1.5", "-1", "", "1e6", " 1", "01", "abc"]) {
    assert.throws(() => parseAtomicAmount(bad), new RegExp(""), `expected ${JSON.stringify(bad)} to throw`);
  }
});

test("arithmetic stays exact past Number.MAX_SAFE_INTEGER", () => {
  assert.equal(addAtomic("9007199254740991", "2"), "9007199254740993");
  assert.equal(subAtomic("9007199254740993", "2"), "9007199254740991");
});

test("subtraction refuses to go negative", () => {
  assert.throws(() => subAtomic("1", "2"), /negative/);
});

test("comparison orders by value, not lexicographically", () => {
  assert.equal(cmpAtomic("9", "10"), -1); // "9" > "10" as strings
  assert.equal(cmpAtomic("10", "9"), 1);
  assert.equal(cmpAtomic("10", "10"), 0);
});

test("i128 ceiling is enforced at the rail boundary", () => {
  const max = ((1n << 127n) - 1n).toString();
  assert.equal(assertFitsI128(max), max);
  assert.throws(() => assertFitsI128((1n << 127n).toString()), /i128/);
});

// --- ids -------------------------------------------------------------------

test("ids carry their entity prefix", () => {
  assert.match(newId("intent"), /^int_[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.match(newId("account"), /^acc_/);
  assert.match(newId("credential"), /^cred_/);
});

test("ids of the wrong entity are rejected", () => {
  const wallet = newId("wallet");
  assert.ok(isId("wallet", wallet));
  assert.ok(!isId("settlement", wallet));
  assert.throws(() => assertId("settlement", wallet), /Expected a settlement id/);
});

test("ulids sort lexicographically by creation time", () => {
  const early = ulid(1_000_000);
  const late = ulid(2_000_000);
  assert.ok(early < late);
});

test("a ulid's timestamp survives the round trip", () => {
  const when = 1_775_000_000_000;
  assert.equal(timestampOf(newId("intent", when)).getTime(), when);
});

test("ids are unique across a tight loop", () => {
  const ids = new Set(Array.from({ length: 5_000 }, () => newId("intent")));
  assert.equal(ids.size, 5_000);
});

test("crockford encoding omits the ambiguous letters", () => {
  const sample = Array.from({ length: 200 }, () => ulid()).join("");
  for (const ambiguous of ["I", "L", "O", "U"]) {
    assert.ok(!sample.includes(ambiguous), `ULID alphabet must not contain ${ambiguous}`);
  }
});

// --- errors ----------------------------------------------------------------

test("PaymodError serializes to the spec's envelope", () => {
  const err = new PaymodError(ERROR_CODES.DAILY_LIMIT_EXCEEDED, "Over the daily cap.", {
    requestId: "req_123",
  });
  assert.deepEqual(err.toJSON(), {
    error: {
      code: "DAILY_LIMIT_EXCEEDED",
      message: "Over the daily cap.",
      requestId: "req_123",
    },
  });
});

test("PaymodError preserves its cause for logging", () => {
  const cause = new Error("connection reset");
  const err = new PaymodError(ERROR_CODES.SETTLEMENT_UNKNOWN, "Unresolved.", { cause });
  assert.equal(err.cause, cause);
  assert.ok(err instanceof Error);
});
