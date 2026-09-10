import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { describeProviderError } from "./parse-error-response.js";

describe("describeProviderError", () => {
  test("extracts message from an OpenAI/Anthropic/PaymodError-shaped body: { error: { message } }", async () => {
    const response = new Response(JSON.stringify({ error: { message: "Insufficient Paymod Code balance for this request.", code: "INSUFFICIENT_CODE_BALANCE" } }), { status: 402 });
    assert.equal(await describeProviderError("OpenAI", response), "Insufficient Paymod Code balance for this request.");
  });

  test("extracts message from a NestJS default HttpException body: { message, error, statusCode }", async () => {
    const response = new Response(JSON.stringify({ message: "Invalid credential", error: "Unauthorized", statusCode: 401 }), { status: 401 });
    assert.equal(await describeProviderError("OpenAI", response), "Invalid credential");
  });

  test("falls back to a short, readable message for a non-JSON body, never the raw text", async () => {
    const response = new Response("invalid api key", { status: 401 });
    assert.equal(await describeProviderError("OpenAI", response), "OpenAI couldn't process this request (status 401).");
  });

  test("falls back cleanly when JSON parses but carries no recognizable message field", async () => {
    const response = new Response(JSON.stringify({ type: "invalid_request_error" }), { status: 400 });
    assert.equal(await describeProviderError("Anthropic", response), "Anthropic couldn't process this request (status 400).");
  });
});
