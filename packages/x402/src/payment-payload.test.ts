import test from "node:test";
import assert from "node:assert/strict";
import { Headers, Response } from "undici";
import { PaymodError } from "@paymod/shared";
import { encodePaymentSignatureHeader, parsePaymentResponse } from "./payment-payload.js";
import type { PaymentRequirements } from "./requirements.js";
import type { SettlementResponse } from "./payment-payload.js";

const requirement: PaymentRequirements = {
  scheme: "exact",
  network: "stellar:testnet",
  amount: "1000000",
  asset: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  payTo: "GDJUR24PJU3XIBZNA6DZT2QVQIQ6ZMMS5A2UO3JG6CPE5TFLG7KNPJ5W",
  maxTimeoutSeconds: 60,
};

test("encodePaymentSignatureHeader round-trips the requirement and a Stellar transaction payload", () => {
  const header = encodePaymentSignatureHeader(requirement, { transaction: "AAAAAgAAAA==" });
  const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8"));

  assert.equal(decoded.x402Version, 2);
  assert.deepEqual(decoded.accepted, requirement);
  assert.equal(decoded.payload.transaction, "AAAAAgAAAA==");
});

test("encodePaymentSignatureHeader round-trips an EVM eip3009 authorization payload", () => {
  const evmPayload = {
    signature: "0xsig",
    authorization: { from: "0xFrom", to: "0xTo", value: "1000000", validAfter: "0", validBefore: "999999999", nonce: "0xnonce" },
  };
  const header = encodePaymentSignatureHeader(requirement, evmPayload);
  const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8"));

  assert.deepEqual(decoded.payload, evmPayload);
});

function settlementHeader(body: SettlementResponse): Headers {
  const headers = new Headers();
  headers.set("PAYMENT-RESPONSE", Buffer.from(JSON.stringify(body)).toString("base64"));
  return headers;
}

test("parses a successful PAYMENT-RESPONSE header", () => {
  const body: SettlementResponse = { success: true, transaction: "deadbeef", network: "stellar:testnet" };
  const response = new Response(null, { status: 200, headers: settlementHeader(body) });

  const parsed = parsePaymentResponse(response);

  assert.equal(parsed.success, true);
  assert.equal(parsed.transaction, "deadbeef");
});

test("parses a failed settlement's PAYMENT-RESPONSE header without throwing (the caller decides what to do with success: false)", () => {
  const body: SettlementResponse = { success: false, errorReason: "insufficient_funds", transaction: "", network: "stellar:testnet" };
  const response = new Response(null, { status: 402, headers: settlementHeader(body) });

  const parsed = parsePaymentResponse(response);

  assert.equal(parsed.success, false);
  assert.equal(parsed.errorReason, "insufficient_funds");
});

test("throws when the PAYMENT-RESPONSE header is missing", () => {
  const response = new Response(null, { status: 200 });
  assert.throws(() => parsePaymentResponse(response), PaymodError);
});
