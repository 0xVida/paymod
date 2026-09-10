import { Body, Controller, Get, NotFoundException, Param, Post, Req, UseGuards, UsePipes } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { WalletCredentialGuard } from "../common/wallet-credential.guard.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { X402Service } from "./x402.service.js";

const x402FetchSchema = z.object({
  url: z.string().url(),
});

@Controller("v1/x402")
@UseGuards(WalletCredentialGuard)
export class X402Controller {
  constructor(private readonly x402: X402Service) {}

  @Post("fetch")
  @UsePipes(new ZodValidationPipe(x402FetchSchema))
  async fetchResource(@Req() req: Request, @Body() body: z.infer<typeof x402FetchSchema>) {
    const { account, wallet } = req.paymod!;
    return this.x402.fetch(account, wallet, body.url);
  }

  @Get(":intentId/result")
  async result(@Req() req: Request, @Param("intentId") intentId: string) {
    const intent = await this.x402.getResult(req.paymod!.wallet.id, intentId);
    if (!intent) throw new NotFoundException("x402 result is not available");
    return intent;
  }
}
