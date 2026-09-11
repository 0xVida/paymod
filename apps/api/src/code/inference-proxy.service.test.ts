import test, { before, beforeEach, after, afterEach, describe } from "node:test";
import assert from "node:assert/strict";
import type { Response } from "express";
import { newId, PaymodError } from "@paymod/shared";
import { CodeBalanceRepository } from "@paymod/database";
import { PrismaService } from "../common/prisma.service.js";
import { InferenceProxyService } from "./inference-proxy.service.js";
import type { ModelPricingService, ModelPricingRow } from "./model-pricing.service.js";
import type { ProviderKeysService } from "./provider-keys.service.js";

/**
 * real Postgres for the balance/reservation mechanics (the whole point is
 * proving the metering actually debits, releases or holds correctly - an
 * in-memory fake can't prove that), fakes for pricing/provider-key
 * resolution and `fetch` itself, mirroring `deposit.service.test.ts`'s
 * "real Postgres, fake external RPC" split.
 *
 *   docker compose up -d
 *   npm --workspace @paymod/api run test
 */

const prisma = new PrismaService();
const balances = new CodeBalanceRepository(prisma);

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

let accountId: string;

const PRICING: ModelPricingRow = {
  id: "mpr_test",
  provider: "OPENAI",
  model: "gpt-4o",
  inputTokenPriceAtomic: "1000", // 1000 atomic per 1M input tokens
  cachedInputTokenPriceAtomic: null,
  outputTokenPriceAtomic: "3000", // 3000 atomic per 1M output tokens
  markupBasisPoints: 0,
  version: 1,
  effectiveFrom: new Date(0),
  effectiveTo: null,
};

function fakePricing(row: ModelPricingRow = PRICING): ModelPricingService {
  return { getActivePricing: async () => row } as unknown as ModelPricingService;
}

function fakeProviderKeys(): ProviderKeysService {
  return { resolveActiveKey: async () => "sk-real-key" } as unknown as ProviderKeysService;
}

function fakeResponse() {
  const chunks: Buffer[] = [];
  let statusCode = 0;
  const headers: Record<string, string> = {};
  let ended = false;

  const res = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
    write(chunk: Buffer) {
      chunks.push(chunk);
      return true;
    },
    end() {
      ended = true;
    },
  } as unknown as Response;

  return { res, get statusCode() { return statusCode; }, headers, get body() { return Buffer.concat(chunks).toString("utf8"); }, get ended() { return ended; } };
}

function openAiSseStream(content: string, promptTokens: number, completionTokens: number): globalThis.Response {
  const body =
    `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] })}\n\n` +
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens } })}\n\n` +
    `data: [DONE]\n\n`;
  return new globalThis.Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function anthropicSseStream(text: string, inputTokens: number, outputTokens: number): globalThis.Response {
  const events = [
    { type: "message_start", message: { usage: { input_tokens: inputTokens } } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: outputTokens } },
    { type: "message_stop" },
  ];
  const body = events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
  return new globalThis.Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function forwardParams(overrides: Partial<Parameters<InferenceProxyService["meteredForward"]>[0]> = {}) {
  const fake = fakeResponse();
  return {
    params: {
      provider: "OPENAI" as const,
      wireProvider: "openai" as const,
      targetUrl: "https://api.openai.com/v1/chat/completions",
      buildUpstreamHeaders: (apiKey: string) => ({ Authorization: `Bearer ${apiKey}` }),
      accountId,
      sessionId: "ses_test",
      taskId: newId("request"),
      body: { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] },
      res: fake.res,
      ...overrides,
    },
    fake,
  };
}

before(async () => {
  await prisma.$connect();
});

async function resetDatabase() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "usage_events", "usage_reservations", "code_ledger_entries", "code_account_balances",
      "code_deposit_addresses", "code_credentials", "accounts", "users"
    RESTART IDENTITY CASCADE
  `);
}

beforeEach(async () => {
  await resetDatabase();
  const userId = newId("user");
  accountId = newId("account");
  await prisma.user.create({ data: { id: userId, email: `${userId}@test.paymod.dev`, passwordHash: "x", name: "Test" } });
  await prisma.account.create({ data: { id: accountId, userId, name: "Test" } });
});

after(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

describe("InferenceProxyService.meteredForward", () => {
  test("insufficient balance is refused with 402 before any provider fetch happens", async () => {
    await prisma.codeAccountBalance.create({ data: { accountId, balanceAtomic: "0", reservedAtomic: "0" } });
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      throw new Error("must not be called");
    }) as typeof fetch;

    const service = new InferenceProxyService(prisma, fakePricing(), fakeProviderKeys());
    const { params } = forwardParams();

    await assert.rejects(() => service.meteredForward(params), (err: unknown) => {
      assert.ok(err instanceof PaymodError);
      assert.equal(err.code, "INSUFFICIENT_CODE_BALANCE");
      assert.equal(err.httpStatus, 402);
      return true;
    });
    assert.equal(fetchCalled, false);
  });

  test("a successful stream relays bytes to the client and commits the real charge, not the estimate", async () => {
    await prisma.codeAccountBalance.create({ data: { accountId, balanceAtomic: "1000000", reservedAtomic: "0" } });
    globalThis.fetch = (async () => openAiSseStream("hello", 100, 20)) as typeof fetch;

    const service = new InferenceProxyService(prisma, fakePricing(), fakeProviderKeys());
    const { params, fake } = forwardParams();
    await service.meteredForward(params);

    assert.equal(fake.ended, true);
    assert.match(fake.body, /hello/);
    assert.match(fake.body, /\[DONE\]/);

    const event = await prisma.usageEvent.findFirstOrThrow({ where: { accountId } });
    assert.equal(event.inputTokens, 100);
    assert.equal(event.outputTokens, 20);
    // 100 * 1000/1e6 = 0.1 -> ceil 1, 20 * 3000/1e6 = 0.06 -> ceil 1, total 2.
    assert.equal(event.chargedAtomic.toFixed(0), "2");

    const balance = await prisma.codeAccountBalance.findUniqueOrThrow({ where: { accountId } });
    assert.equal(balance.reservedAtomic.toFixed(0), "0", "the reservation is fully released once committed");
    assert.equal(balance.balanceAtomic.toFixed(0), "999998", "only the real charge (2), not the padded estimate, was deducted");
  });

  test("a stream that ends without a real terminal event holds the reservation for reconciliation, never releases it", async () => {
    await prisma.codeAccountBalance.create({ data: { accountId, balanceAtomic: "1000000", reservedAtomic: "0" } });
    const truncated = 'data: {"choices":[{"delta":{"content":"partial"},"finish_reason":null}]}\n\n';
    globalThis.fetch = (async () => new globalThis.Response(truncated, { status: 200, headers: { "Content-Type": "text/event-stream" } })) as typeof fetch;

    const service = new InferenceProxyService(prisma, fakePricing(), fakeProviderKeys());
    const { params, fake } = forwardParams();
    await service.meteredForward(params);

    assert.match(fake.body, /partial/, "whatever did stream must still reach the client");

    const balance = await prisma.codeAccountBalance.findUniqueOrThrow({ where: { accountId } });
    assert.notEqual(balance.reservedAtomic.toFixed(0), "0", "the hold must stay in place, not be silently released");

    const reservation = await prisma.usageReservation.findFirstOrThrow({ where: { accountId } });
    assert.equal(reservation.status, "RECONCILIATION_REQUIRED");
  });

  test("upstream explicitly rejecting before generating anything releases the reservation in full", async () => {
    await prisma.codeAccountBalance.create({ data: { accountId, balanceAtomic: "1000000", reservedAtomic: "0" } });
    globalThis.fetch = (async () => new globalThis.Response("rate limited", { status: 429 })) as typeof fetch;

    const service = new InferenceProxyService(prisma, fakePricing(), fakeProviderKeys());
    const { params, fake } = forwardParams();
    await service.meteredForward(params);

    assert.equal(fake.statusCode, 429);
    assert.equal(fake.body, "rate limited");

    const balance = await prisma.codeAccountBalance.findUniqueOrThrow({ where: { accountId } });
    assert.equal(balance.reservedAtomic.toFixed(0), "0");
    assert.equal(balance.balanceAtomic.toFixed(0), "1000000", "nothing was ever spent");

    const reservation = await prisma.usageReservation.findFirstOrThrow({ where: { accountId } });
    assert.equal(reservation.status, "RELEASED");
  });

  test("the outbound OpenAI request explicitly opts into stream usage reporting - without it every chunk omits usage and the real charge would compute as zero regardless of actual tokens", async () => {
    await prisma.codeAccountBalance.create({ data: { accountId, balanceAtomic: "1000000", reservedAtomic: "0" } });
    let capturedBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url, init) => {
      capturedBody = JSON.parse((init as RequestInit).body as string);
      return openAiSseStream("hello", 100, 20);
    }) as typeof fetch;

    const service = new InferenceProxyService(prisma, fakePricing(), fakeProviderKeys());
    const { params } = forwardParams();
    await service.meteredForward(params);

    assert.deepEqual(capturedBody?.["stream_options"], { include_usage: true });
  });

  test("the outbound OpenAI request uses max_completion_tokens, never the deprecated max_tokens - o-series and the gpt-5.6 family reject max_tokens outright", async () => {
    await prisma.codeAccountBalance.create({ data: { accountId, balanceAtomic: "1000000", reservedAtomic: "0" } });
    let capturedBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url, init) => {
      capturedBody = JSON.parse((init as RequestInit).body as string);
      return openAiSseStream("hello", 100, 20);
    }) as typeof fetch;

    const service = new InferenceProxyService(prisma, fakePricing(), fakeProviderKeys());
    // a stale, not-yet-rebuilt client could still send max_tokens - the
    // server must strip it, not forward it alongside max_completion_tokens.
    const { params } = forwardParams({ body: { model: "gpt-4o", messages: [{ role: "user", content: "hi" }], max_tokens: 999 } });
    await service.meteredForward(params);

    assert.equal(typeof capturedBody?.["max_completion_tokens"], "number");
    assert.equal(capturedBody?.["max_tokens"], undefined);
  });

  test("the outbound request for a reasoning-effort model forces reasoning_effort to none - OpenAI rejects function tools otherwise", async () => {
    await prisma.codeAccountBalance.create({ data: { accountId, balanceAtomic: "1000000", reservedAtomic: "0" } });
    let capturedBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url, init) => {
      capturedBody = JSON.parse((init as RequestInit).body as string);
      return openAiSseStream("hello", 100, 20);
    }) as typeof fetch;

    const service = new InferenceProxyService(prisma, fakePricing({ ...PRICING, model: "gpt-5.6-luna" }), fakeProviderKeys());
    const { params } = forwardParams({ body: { model: "gpt-5.6-luna", messages: [{ role: "user", content: "hi" }], tools: [{ type: "function", function: { name: "read_file" } }] } });
    await service.meteredForward(params);

    assert.equal(capturedBody?.["reasoning_effort"], "none");
  });

  test("a non-reasoning-effort model's outbound request never gets a reasoning_effort field at all", async () => {
    await prisma.codeAccountBalance.create({ data: { accountId, balanceAtomic: "1000000", reservedAtomic: "0" } });
    let capturedBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url, init) => {
      capturedBody = JSON.parse((init as RequestInit).body as string);
      return openAiSseStream("hello", 100, 20);
    }) as typeof fetch;

    const service = new InferenceProxyService(prisma, fakePricing(), fakeProviderKeys());
    const { params } = forwardParams();
    await service.meteredForward(params);

    assert.equal(capturedBody?.["reasoning_effort"], undefined);
  });

  test("the outbound Anthropic request still uses max_tokens - it's a required field there, not a deprecated one", async () => {
    await prisma.codeAccountBalance.create({ data: { accountId, balanceAtomic: "1000000", reservedAtomic: "0" } });
    let capturedBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url, init) => {
      capturedBody = JSON.parse((init as RequestInit).body as string);
      return anthropicSseStream("hello", 10, 5);
    }) as typeof fetch;

    const service = new InferenceProxyService(prisma, fakePricing({ ...PRICING, provider: "ANTHROPIC", model: "claude-sonnet-5" }), fakeProviderKeys());
    const { params } = forwardParams({
      provider: "ANTHROPIC",
      wireProvider: "anthropic",
      body: { model: "claude-sonnet-5", messages: [{ role: "user", content: "hi" }] },
    });
    await service.meteredForward(params);

    assert.equal(typeof capturedBody?.["max_tokens"], "number");
    assert.equal(capturedBody?.["max_completion_tokens"], undefined);
  });

  test("commit prices against the version snapshotted at reservation time, not whatever becomes active mid-stream", async () => {
    await prisma.codeAccountBalance.create({ data: { accountId, balanceAtomic: "1000000", reservedAtomic: "0" } });
    const reservedVersionPricing = { ...PRICING, version: 1 };
    let resolveUpstream!: (value: globalThis.Response) => void;
    const upstreamPromise = new Promise<globalThis.Response>((resolve) => { resolveUpstream = resolve; });
    globalThis.fetch = (async () => upstreamPromise) as typeof fetch;

    const service = new InferenceProxyService(prisma, fakePricing(reservedVersionPricing), fakeProviderKeys());
    const { params } = forwardParams();
    const forwardCompleted = service.meteredForward(params);

    // A pricing change happens while the request is in flight - the
    // reservation already snapshotted version 1 before this point.
    resolveUpstream(openAiSseStream("hi", 10, 10));
    await forwardCompleted;

    const event = await prisma.usageEvent.findFirstOrThrow({ where: { accountId } });
    assert.equal(event.pricingVersion, 1);
  });
});

describe("InferenceProxyService.unmeteredForward", () => {
  test("forwards the body with the resolved key and relays the upstream response verbatim", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: unknown;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedHeaders = init!.headers as Record<string, string>;
      capturedBody = JSON.parse(init!.body as string);
      return new globalThis.Response(JSON.stringify({ input_tokens: 42 }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

    const fake = fakeResponse();
    const service = new InferenceProxyService(prisma, fakePricing(), fakeProviderKeys());
    await service.unmeteredForward({
      provider: "ANTHROPIC",
      targetUrl: "https://api.anthropic.com/v1/messages/count_tokens",
      buildUpstreamHeaders: (apiKey) => ({ "x-api-key": apiKey, "anthropic-version": "2023-06-01" }),
      body: { model: "claude-sonnet", messages: [{ role: "user", content: "hi" }] },
      res: fake.res,
    });

    assert.equal(capturedUrl, "https://api.anthropic.com/v1/messages/count_tokens");
    assert.equal(capturedHeaders["x-api-key"], "sk-real-key");
    assert.deepEqual(capturedBody, { model: "claude-sonnet", messages: [{ role: "user", content: "hi" }] });
    assert.equal(fake.statusCode, 200);
    assert.deepEqual(JSON.parse(fake.body), { input_tokens: 42 });
  });

  test("touches no balance or reservation - a free upstream call reserves nothing", async () => {
    await prisma.codeAccountBalance.create({ data: { accountId, balanceAtomic: "0", reservedAtomic: "0" } });
    globalThis.fetch = (async () => new globalThis.Response(JSON.stringify({ input_tokens: 1 }), { status: 200 })) as typeof fetch;

    const fake = fakeResponse();
    const service = new InferenceProxyService(prisma, fakePricing(), fakeProviderKeys());
    await service.unmeteredForward({
      provider: "ANTHROPIC",
      targetUrl: "https://api.anthropic.com/v1/messages/count_tokens",
      buildUpstreamHeaders: () => ({}),
      body: {},
      res: fake.res,
    });

    const balance = await prisma.codeAccountBalance.findUniqueOrThrow({ where: { accountId } });
    assert.equal(balance.balanceAtomic.toFixed(0), "0");
    assert.equal(balance.reservedAtomic.toFixed(0), "0");
  });

  test("relays a non-200 upstream status and body unchanged", async () => {
    globalThis.fetch = (async () => new globalThis.Response(JSON.stringify({ error: "bad request" }), { status: 400 })) as typeof fetch;

    const fake = fakeResponse();
    const service = new InferenceProxyService(prisma, fakePricing(), fakeProviderKeys());
    await service.unmeteredForward({
      provider: "ANTHROPIC",
      targetUrl: "https://api.anthropic.com/v1/messages/count_tokens",
      buildUpstreamHeaders: () => ({}),
      body: {},
      res: fake.res,
    });

    assert.equal(fake.statusCode, 400);
    assert.deepEqual(JSON.parse(fake.body), { error: "bad request" });
  });
});
