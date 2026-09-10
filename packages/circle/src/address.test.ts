import test from "node:test";
import assert from "node:assert/strict";
import { isValidEvmAddress } from "./address.js";

test("accepts a well-formed EVM address", () => {
  assert.equal(isValidEvmAddress("0x1234567890abcdef1234567890abcdef12345678"), true);
});

test("rejects an address without the 0x prefix", () => {
  assert.equal(isValidEvmAddress("1234567890abcdef1234567890abcdef12345678"), false);
});

test("rejects an address with the wrong length", () => {
  assert.equal(isValidEvmAddress("0x1234"), false);
});

test("rejects a Stellar address", () => {
  assert.equal(isValidEvmAddress("GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"), false);
});
