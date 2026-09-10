import { randomUUID } from "node:crypto";
import { Body, Controller, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { CodeCredentialGuard } from "../common/code-credential.guard.js";
import { InferenceProxyService } from "./inference-proxy.service.js";

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_COUNT_TOKENS_URL = "https://api.anthropic.com/v1/messages/count_tokens";
const ANTHROPIC_VERSION = "2023-06-01";

/**
 * Provider keys never ship in the extension: clients point at these routes
 * with a `pmcode_...` credential and `InferenceProxyService` injects the
 * real key server-side after reserving the charge. Routes mirror each
 * provider's own paths exactly so switching between Paymod-managed and BYOK
 * is just a `baseUrl` change.
 *
 * `sessionId`/`taskId` are opaque client-generated correlation strings (see
 * `UsageReservation`'s docblock for why nothing verifies them server-side);
 * optional and defaulted to a random id so older clients still work, just
 * without task-level cost grouping.
 */
@Controller("v1/code/inference")
export class InferenceProxyController {
  constructor(private readonly proxy: InferenceProxyService) {}

  @Post("openai/chat/completions")
  @UseGuards(CodeCredentialGuard)
  openai(@Body() body: Record<string, unknown>, @Req() req: Request, @Res() res: Response) {
    return this.proxy.meteredForward({
      provider: "OPENAI",
      wireProvider: "openai",
      targetUrl: OPENAI_CHAT_COMPLETIONS_URL,
      buildUpstreamHeaders: (apiKey) => ({ Authorization: `Bearer ${apiKey}` }),
      accountId: req.paymod!.account.id,
      sessionId: correlationId(req, "x-paymod-session-id"),
      taskId: correlationId(req, "x-paymod-task-id"),
      body,
      res,
    });
  }

  @Post("anthropic/v1/messages")
  @UseGuards(CodeCredentialGuard)
  anthropic(@Body() body: Record<string, unknown>, @Req() req: Request, @Res() res: Response) {
    return this.proxy.meteredForward({
      provider: "ANTHROPIC",
      wireProvider: "anthropic",
      targetUrl: ANTHROPIC_MESSAGES_URL,
      buildUpstreamHeaders: (apiKey) => ({ "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION }),
      accountId: req.paymod!.account.id,
      sessionId: correlationId(req, "x-paymod-session-id"),
      taskId: correlationId(req, "x-paymod-task-id"),
      body,
      res,
    });
  }

  /**
   * Free on Anthropic's side, with its own rate limit separate from real
   * Messages calls (docs.claude.com) - forwarded through `unmeteredForward`
   * so no balance reservation happens. Still behind `CodeCredentialGuard`:
   * unauthenticated, anyone could spend Paymod's Anthropic rate limit for
   * free.
   */
  @Post("anthropic/v1/messages/count_tokens")
  @UseGuards(CodeCredentialGuard)
  anthropicCountTokens(@Body() body: Record<string, unknown>, @Res() res: Response) {
    return this.proxy.unmeteredForward({
      provider: "ANTHROPIC",
      targetUrl: ANTHROPIC_COUNT_TOKENS_URL,
      buildUpstreamHeaders: (apiKey) => ({ "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION }),
      body,
      res,
    });
  }
}

function correlationId(req: Request, header: string): string {
  const value = req.headers[header];
  return typeof value === "string" && value.length > 0 ? value : randomUUID();
}
