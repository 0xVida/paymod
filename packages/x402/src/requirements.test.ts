import test from "node:test";
import assert from "node:assert/strict";
import { Headers, Response } from "undici";
import { ERROR_CODES, PaymodError } from "@paymod/shared";
import {
  parsePaymentRequiredResponse,
  selectStellarExactRequirement,
  selectEvmExactRequirement,
  type PaymentRequiredResponse,
  type PaymentRequirements,
} from "./requirements.js";

function stellarRequirement(overrides: Partial<PaymentRequirements> = {}): PaymentRequirements {
  return {
    scheme: "exact",
    network: "stellar:testnet",
    amount: "1000000",
    asset: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    payTo: "GDJUR24PJU3XIBZNA6DZT2QVQIQ6ZMMS5A2UO3JG6CPE5TFLG7KNPJ5W",
    maxTimeoutSeconds: 60,
    ...overrides,
  };
}

function paymentRequiredHeader(body: PaymentRequiredResponse): Headers {
  const headers = new Headers();
  headers.set("PAYMENT-REQUIRED", Buffer.from(JSON.stringify(body)).toString("base64"));
  return headers;
}

test("parses a well-formed PAYMENT-REQUIRED header off a 402 response", () => {
  const body: PaymentRequiredResponse = { x402Version: 2, accepts: [stellarRequirement()] };
  const response = new Response(null, { status: 402, headers: paymentRequiredHeader(body) });

  const parsed = parsePaymentRequiredResponse(response);

  assert.equal(parsed.accepts.length, 1);
  assert.equal(parsed.accepts[0]!.network, "stellar:testnet");
});

test("rejects a non-402 status regardless of headers", () => {
  const body: PaymentRequiredResponse = { x402Version: 2, accepts: [stellarRequirement()] };
  const response = new Response(null, { status: 200, headers: paymentRequiredHeader(body) });

  assert.throws(() => parsePaymentRequiredResponse(response), PaymodError);
});

test("rejects a 402 with no PAYMENT-REQUIRED header", () => {
  const response = new Response(null, { status: 402 });
  assert.throws(() => parsePaymentRequiredResponse(response), /PAYMENT-REQUIRED/);
});

test("rejects a PAYMENT-REQUIRED header that is not valid base64 JSON", () => {
  const headers = new Headers({ "PAYMENT-REQUIRED": "not-base64-json!!" });
  const response = new Response(null, { status: 402, headers });
  assert.throws(() => parsePaymentRequiredResponse(response), /base64/);
});

test("rejects a decoded header that fails schema validation", () => {
  const headers = new Headers();
  headers.set("PAYMENT-REQUIRED", Buffer.from(JSON.stringify({ x402Version: 2, accepts: [] })).toString("base64"));
  const response = new Response(null, { status: 402, headers });
  assert.throws(() => parsePaymentRequiredResponse(response), /schema/);
});

const config = {
  networkId: "stellar:testnet",
  tokenContractId: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
};

test("selects the matching exact/stellar:testnet/configured-asset requirement", () => {
  const response: PaymentRequiredResponse = {
    x402Version: 2,
    accepts: [
      stellarRequirement({ network: "eip155:8453", asset: "0xUSDC" }),
      stellarRequirement(),
    ],
  };
  const selected = selectStellarExactRequirement(response, config);
  assert.equal(selected.network, "stellar:testnet");
});

test("rejects when no offered requirement uses the exact scheme", () => {
  const response: PaymentRequiredResponse = { x402Version: 2, accepts: [stellarRequirement({ scheme: "upto" })] };
  assert.throws(() => selectStellarExactRequirement(response, config), /X402_INVALID_REQUIREMENTS|exact/);
});

test("rejects when the exact requirement is offered on a different network", () => {
  const response: PaymentRequiredResponse = { x402Version: 2, accepts: [stellarRequirement({ network: "stellar:pubnet" })] };
  assert.throws(
    () => selectStellarExactRequirement(response, config),
    (error: unknown) => error instanceof PaymodError && error.code === ERROR_CODES.X402_UNSUPPORTED_NETWORK,
  );
});

test("rejects when the network matches but the asset (by contract address, not symbol) does not", () => {
  const response: PaymentRequiredResponse = {
    x402Version: 2,
    accepts: [stellarRequirement({ asset: "CDIFFERENTTOKENCONTRACTADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXX" })],
  };
  assert.throws(() => selectStellarExactRequirement(response, config), /asset/i);
});

function evmRequirement(overrides: Partial<PaymentRequirements> = {}): PaymentRequirements {
  return {
    scheme: "exact",
    network: "eip155:11155111",
    amount: "1000000",
    asset: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287",
    maxTimeoutSeconds: 60,
    extra: { assetTransferMethod: "eip3009", name: "USDC", version: "2" },
    ...overrides,
  };
}

const evmConfig = {
  networkId: "eip155:11155111",
  tokenAddress: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
};

test("selects the matching exact/eip155/configured-asset requirement, case-insensitively", () => {
  const response: PaymentRequiredResponse = {
    x402Version: 2,
    accepts: [
      evmRequirement({ network: "eip155:8453" }),
      evmRequirement({ asset: "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238" }),
    ],
  };
  const selected = selectEvmExactRequirement(response, evmConfig);
  assert.equal(selected.network, "eip155:11155111");
  assert.equal(selected.extra.name, "USDC");
  assert.equal(selected.extra.version, "2");
});

test("defaults to eip3009 when assetTransferMethod is absent", () => {
  const response: PaymentRequiredResponse = {
    x402Version: 2,
    accepts: [evmRequirement({ extra: { name: "USDC", version: "2" } })],
  };
  const selected = selectEvmExactRequirement(response, evmConfig);
  assert.equal(selected.network, "eip155:11155111");
});

test("rejects a permit2/erc7710 requirement - only eip3009 is implemented", () => {
  const response: PaymentRequiredResponse = {
    x402Version: 2,
    accepts: [evmRequirement({ extra: { assetTransferMethod: "permit2", name: "USDC", version: "2" } })],
  };
  assert.throws(
    () => selectEvmExactRequirement(response, evmConfig),
    (error: unknown) => error instanceof PaymodError && error.code === ERROR_CODES.X402_INVALID_REQUIREMENTS,
  );
});

test("rejects a requirement missing extra.name/extra.version", () => {
  const response: PaymentRequiredResponse = { x402Version: 2, accepts: [evmRequirement({ extra: { assetTransferMethod: "eip3009" } })] };
  assert.throws(() => selectEvmExactRequirement(response, evmConfig), /extra\.name/);
});

test("rejects when the network matches but the asset does not", () => {
  const response: PaymentRequiredResponse = { x402Version: 2, accepts: [evmRequirement({ asset: "0xDifferentToken" })] };
  assert.throws(
    () => selectEvmExactRequirement(response, evmConfig),
    (error: unknown) => error instanceof PaymodError && error.code === ERROR_CODES.X402_UNSUPPORTED_ASSET,
  );
});
