import test from "node:test";
import assert from "node:assert/strict";
import { assertTreasuryUsableBy, assertValidContractId, type TreasuryState } from "./treasury-state.js";

const baseState: TreasuryState = {
  owner: "GOWNER",
  executor: "GEXEC",
  token: "CTOKEN",
  paused: false,
  maxPerPaymentAtomic: "2000000",
  maxPerPeriodAtomic: "20000000",
  periodSeconds: 86400,
  periodStart: 1_000_000,
  rawSpentInPeriodAtomic: "500000",
  spentInPeriodAtomic: "500000",
  latestLedger: 12345,
  lastModifiedLedger: 12000,
};

test("a paused treasury is rejected regardless of executor/token match", () => {
  assert.throws(
    () => assertTreasuryUsableBy({ ...baseState, paused: true }, { executor: "GEXEC", token: "CTOKEN" }),
    /paused/i,
  );
});

test("a treasury whose executor does not match Paymod's configured key is rejected", () => {
  assert.throws(
    () => assertTreasuryUsableBy(baseState, { executor: "GDIFFERENT", token: "CTOKEN" }),
    /executor/i,
  );
});

test("a treasury holding an unexpected token is rejected", () => {
  assert.throws(
    () => assertTreasuryUsableBy(baseState, { executor: "GEXEC", token: "CWRONGTOKEN" }),
    /token/i,
  );
});

test("a matching, unpaused treasury passes", () => {
  assert.doesNotThrow(() => assertTreasuryUsableBy(baseState, { executor: "GEXEC", token: "CTOKEN" }));
});

test("a well-formed contract address passes through unchanged", () => {
  const id = "CCQBVEGLHCXPJUDRP7D5XLHSDG34L5PFYUAJWDTK3FYGHUDY7OWJV4GD";
  assert.equal(assertValidContractId(id), id);
});

test("a malformed contract address is rejected at the boundary", () => {
  assert.throws(() => assertValidContractId("not-a-contract-id"));
});
