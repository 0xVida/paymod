import test from "node:test";
import assert from "node:assert/strict";
import { isValidPaymentDestination, isValidStellarAddress } from "./address.js";

// real testnet addresses, from tools/paymod-testnet's spike run (public only).
const OWNER = "GDJUR24PJU3XIBZNA6DZT2QVQIQ6ZMMS5A2UO3JG6CPE5TFLG7KNPJ5W";
const TREASURY_CONTRACT = "CCQBVEGLHCXPJUDRP7D5XLHSDG34L5PFYUAJWDTK3FYGHUDY7OWJV4GD";

test("a classic account address is a valid Stellar address", () => {
  assert.equal(isValidStellarAddress(OWNER), true);
});

test("a contract address is a valid Stellar address but not a payment destination", () => {
  assert.equal(isValidStellarAddress(TREASURY_CONTRACT), true);
  assert.equal(isValidPaymentDestination(TREASURY_CONTRACT), false);
});

test("a classic account address is a valid payment destination", () => {
  assert.equal(isValidPaymentDestination(OWNER), true);
});

test("garbage is rejected by both", () => {
  for (const bad of ["", "not-an-address", "G" + "X".repeat(55), OWNER.slice(0, -1)]) {
    assert.equal(isValidStellarAddress(bad), false, bad);
    assert.equal(isValidPaymentDestination(bad), false, bad);
  }
});

test("an Ethereum-shaped address is rejected", () => {
  assert.equal(isValidPaymentDestination("0x0000000000000000000000000000000000dEaD"), false);
});
