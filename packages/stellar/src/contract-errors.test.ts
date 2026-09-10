import test from "node:test";
import assert from "node:assert/strict";
import { parseSimulationErrorCode, parseSimulationErrorName, PaymentAlreadyExecutedError } from "./contract-errors.js";

// these two error strings are copied verbatim from live simulation responses
// against the deployed spike treasury (CCQBVE...4GD, Stellar Testnet), not
// synthesized: see packages/stellar/src/rail.ts's comment on `confirm()`.

const REAL_PER_PAYMENT_LIMIT_ERROR =
  'HostError: Error(Contract, #6)\n\nEvent log (newest first):\n' +
  '   0: [Diagnostic Event] contract:CCQBVEGLHCXPJUDRP7D5XLHSDG34L5PFYUAJWDTK3FYGHUDY7OWJV4GD, ' +
  'topics:[error, Error(Contract, #6)], data:"escalating Ok(ScErrorType::Contract) frame-exit to Err"\n' +
  '   1: [Diagnostic Event] topics:[fn_call, CCQBVEGLHCXPJUDRP7D5XLHSDG34L5PFYUAJWDTK3FYGHUDY7OWJV4GD, execute_payment], ' +
  'data:[Bytes(0000000000000000000000000000000000000000000000000000000000000042), ' +
  'GDJUR24PJU3XIBZNA6DZT2QVQIQ6ZMMS5A2UO3JG6CPE5TFLG7KNPJ5W, 99999999]\n';

const REAL_ALREADY_EXECUTED_ERROR =
  'HostError: Error(Contract, #8)\n\nEvent log (newest first):\n' +
  '   0: [Diagnostic Event] contract:CCQBVEGLHCXPJUDRP7D5XLHSDG34L5PFYUAJWDTK3FYGHUDY7OWJV4GD, ' +
  'topics:[error, Error(Contract, #8)], data:"escalating Ok(ScErrorType::Contract) frame-exit to Err"\n' +
  '   1: [Diagnostic Event] topics:[fn_call, CCQBVEGLHCXPJUDRP7D5XLHSDG34L5PFYUAJWDTK3FYGHUDY7OWJV4GD, execute_payment], ' +
  'data:[Bytes(0100000000000000000000000000000000000000000000000000000000000000), ' +
  'GDJUR24PJU3XIBZNA6DZT2QVQIQ6ZMMS5A2UO3JG6CPE5TFLG7KNPJ5W, 1]\n';

test("parses the real per-payment-limit error verbatim from the live contract", () => {
  assert.equal(parseSimulationErrorCode(REAL_PER_PAYMENT_LIMIT_ERROR), 6);
  assert.equal(parseSimulationErrorName(REAL_PER_PAYMENT_LIMIT_ERROR), "PerPaymentLimitExceeded");
});

test("parses the real already-executed error verbatim from the live contract", () => {
  assert.equal(parseSimulationErrorCode(REAL_ALREADY_EXECUTED_ERROR), 8);
  assert.equal(parseSimulationErrorName(REAL_ALREADY_EXECUTED_ERROR), "PaymentAlreadyExecuted");
});

test("an unrecognized error shape parses to undefined rather than a wrong guess", () => {
  assert.equal(parseSimulationErrorCode("some unrelated RPC failure"), undefined);
  assert.equal(parseSimulationErrorCode(""), undefined);
});

test("PaymentAlreadyExecutedError carries the payment id that was already settled", () => {
  const err = new PaymentAlreadyExecutedError("deadbeef");
  assert.equal(err.paymentId, "deadbeef");
  assert.match(err.message, /deadbeef/);
  assert.equal(err.name, "PaymentAlreadyExecutedError");
});
