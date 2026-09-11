import { Injectable } from "@nestjs/common";
import type { Response as ExpressResponse } from "express";
import type { InferenceProvider } from "@paymod/database";
import { CodeBalanceRepository } from "@paymod/database";
import { ERROR_CODES, PaymodError } from "@paymod/shared";
import { parseSseLines, parseOpenAiStream, parseAnthropicStream } from "@paymod/model-wire";
import type { ModelEvent, ModelUsage } from "@paymod/model-wire";
import { PrismaService } from "../common/prisma.service.js";
import { ModelPricingService } from "./model-pricing.service.js";
import { ProviderKeysService } from "./provider-keys.service.js";
import { resolveEffectiveMaxOutput, extractRequestedMaxOutput, needsReasoningEffortNone } from "./model-limits.js";
import { estimateMaxChargeAtomic, computeActualChargeAtomic } from "./usage-pricing.js";

export type MeteredForwardParams = {
  provider: InferenceProvider;
  wireProvider: "openai" | "anthropic";
  targetUrl: string;
  buildUpstreamHeaders: (apiKey: string) => Record<string, string>;
  accountId: string;
  sessionId: string;
  taskId: string;
  body: Record<string, unknown>;
  res: ExpressResponse;
};

export type UnmeteredForwardParams = {
  provider: InferenceProvider;
  targetUrl: string;
  buildUpstreamHeaders: (apiKey: string) => Record<string, string>;
  body: Record<string, unknown>;
  res: ExpressResponse;
};

/** writes each chunk to the client, then yields it - a single read drives both the relay and the usage parser reading the exact same bytes, no second request and no double consumption of the upstream reader */
async function* teeToResponse(reader: ReadableStreamDefaultReader<Uint8Array>, res: ExpressResponse): AsyncGenerator<Uint8Array> {
  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    try {
      res.write(value);
    } catch {
      // the client disconnected. keep draining the upstream reader anyway -
      // the provider may still be generating (and billing) tokens, and the
      // real final usage is what determines the actual charge, never an
      // assumption that a dropped connection means zero cost.
    }
    yield value;
  }
}

async function relayBytes(reader: ReadableStreamDefaultReader<Uint8Array>, res: ExpressResponse): Promise<void> {
  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    try {
      res.write(value);
    } catch {
      return;
    }
  }
}

/**
 * the metered inference proxy (PAYMOD_CODE_PLAN.md's debit-side design) -
 * reserves an estimated charge before forwarding, then commits the real
 * charge against the pricing version snapshotted at reservation time.
 *
 * failure handling mirrors `packages/database/src/reservations.ts` - release
 * in full only on proven non-execution (never reached the provider, or it
 * rejected before generating anything) - anything indeterminate (a read
 * failure mid-stream, or a stream with no terminal event) goes to
 * RECONCILIATION_REQUIRED and stays held, never auto-released.
 */
@Injectable()
export class InferenceProxyService {
  private readonly balances: CodeBalanceRepository;

  constructor(
    prisma: PrismaService,
    private readonly pricingService: ModelPricingService,
    private readonly providerKeys: ProviderKeysService,
  ) {
    this.balances = new CodeBalanceRepository(prisma);
  }

  async meteredForward(params: MeteredForwardParams): Promise<void> {
    const model = String(params.body["model"] ?? "");

    const pricing = await this.pricingService.getActivePricing(params.provider, model);
    const apiKey = await this.providerKeys.resolveActiveKey(params.provider);

    const effectiveMaxOutput = resolveEffectiveMaxOutput(model, extractRequestedMaxOutput(params.body));
    // drop whatever the client sent under either name first - an older,
    // not-yet-rebuilt client could still send max_tokens for OpenAI, and
    // leaving it in place alongside max_completion_tokens would still get
    // the whole request rejected. the server always decides the outbound
    // field name and value, never trusts the client's.
    const { max_tokens: _clientMaxTokens, max_completion_tokens: _clientMaxCompletionTokens, ...bodyWithoutMaxTokens } = params.body;
    const outboundBody = {
      ...bodyWithoutMaxTokens,
      // max_completion_tokens for OpenAI: max_tokens is deprecated and
      // outright rejected by o-series and the gpt-5.6 family ("Unsupported
      // parameter"). Anthropic still wants max_tokens - it's a required
      // field there, not a deprecated one.
      ...(params.wireProvider === "openai" ? { max_completion_tokens: effectiveMaxOutput } : { max_tokens: effectiveMaxOutput }),
      // o-series and the gpt-5.6 family reject function tools outright
      // unless reasoning_effort is "none" - forced here for the same
      // reason max output is: an older client shouldn't be able to
      // reintroduce this by not sending it.
      ...(params.wireProvider === "openai" && needsReasoningEffortNone(model) && { reasoning_effort: "none" }),
      stream: true,
      // OpenAI only reports usage in the final chunk when explicitly opted
      // in - without this every charge would compute against 0 tokens.
      // Anthropic reports usage unconditionally. forced here rather than
      // trusted from the client since billing correctness can't depend on
      // caller-supplied fields.
      ...(params.wireProvider === "openai" && { stream_options: { include_usage: true } }),
    };
    const estimatedAtomic = estimateMaxChargeAtomic(pricing, effectiveMaxOutput, outboundBody);

    const reservation = await this.balances.reserve({
      accountId: params.accountId,
      sessionId: params.sessionId,
      taskId: params.taskId,
      provider: params.provider,
      model,
      pricingVersion: pricing.version,
      estimatedAtomic,
    });
    if (!reservation.ok) {
      throw new PaymodError(ERROR_CODES.INSUFFICIENT_CODE_BALANCE, "Insufficient Paymod Code balance for this request.", { httpStatus: 402 });
    }

    const upstream = await fetch(params.targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...params.buildUpstreamHeaders(apiKey) },
      body: JSON.stringify(outboundBody),
    }).catch(async (err) => {
      // never reached the provider at all - the reservation covered
      // nothing real.
      await this.balances.release(reservation.reservationId);
      throw err;
    });

    params.res.status(upstream.status);
    params.res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "application/json");
    const providerRequestId = upstream.headers.get("x-request-id") ?? upstream.headers.get("request-id") ?? undefined;

    if (!upstream.ok || !upstream.body) {
      // the provider explicitly rejected the request before generating
      // anything (or sent no body). still relay whatever it did send so
      // the client sees the real provider error, not a generic one.
      if (upstream.body) await relayBytes(upstream.body.getReader(), params.res);
      params.res.end();
      await this.balances.release(reservation.reservationId);
      return;
    }

    let finalUsage: ModelUsage | undefined;
    try {
      const events =
        params.wireProvider === "openai"
          ? parseOpenAiStream(parseSseLines(teeToResponse(upstream.body.getReader(), params.res)))
          : parseAnthropicStream(parseSseLines(teeToResponse(upstream.body.getReader(), params.res)));
      for await (const event of events as AsyncGenerator<ModelEvent>) {
        if (event.type === "message_stop") finalUsage = event.response.usage;
      }
    } catch {
      // a real upstream read failure (not a client-write failure, which
      // teeToResponse already swallows). tokens may have been generated
      // and billed but can no longer be observed - never assume zero cost.
      await this.balances.markReconciliationRequired(reservation.reservationId);
      return;
    } finally {
      try {
        params.res.end();
      } catch {
        // already ended, or the client is gone
      }
    }

    if (!finalUsage) {
      // the stream ended cleanly but never reached a genuine terminal
      // signal - the same indeterminate outcome as a read failure.
      await this.balances.markReconciliationRequired(reservation.reservationId);
      return;
    }

    const charge = computeActualChargeAtomic(pricing, finalUsage);
    await this.balances.commit(reservation.reservationId, {
      inputTokens: finalUsage.inputTokens,
      cachedInputTokens: finalUsage.cachedInputTokens,
      outputTokens: finalUsage.outputTokens,
      providerCostAtomic: charge.providerCostAtomic,
      markupAtomic: charge.markupAtomic,
      actualAtomic: charge.chargedAtomic,
      providerRequestId,
    });
  }

  /**
   * no cost to reserve against - `/v1/messages/count_tokens` is free and
   * separately rate-limited from real Messages calls (docs.claude.com), so
   * wrapping it in the reservation/commit machinery would be wrong, not
   * just unnecessary. still gated by `CodeCredentialGuard` at the
   * controller to stop free passthrough abuse of Paymod's own rate limit.
   */
  async unmeteredForward(params: UnmeteredForwardParams): Promise<void> {
    const apiKey = await this.providerKeys.resolveActiveKey(params.provider);
    const upstream = await fetch(params.targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...params.buildUpstreamHeaders(apiKey) },
      body: JSON.stringify(params.body),
    });

    params.res.status(upstream.status);
    params.res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "application/json");
    params.res.write(Buffer.from(await upstream.text(), "utf8"));
    params.res.end();
  }
}
