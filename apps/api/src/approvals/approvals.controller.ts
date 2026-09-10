import { Controller, Delete, Get, Headers, Post, Req, Body, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { SessionGuard } from "../common/session.guard.js";
import { TelegramService } from "./telegram.service.js";

@Controller("v1/approvals/telegram")
export class ApprovalsController {
  constructor(private readonly telegram: TelegramService) {}

  @Post("link")
  @UseGuards(SessionGuard)
  createLink(@Req() req: Request) {
    return this.telegram.createLink(req.paymodUser!.account.id);
  }

  @Get()
  @UseGuards(SessionGuard)
  getConnection(@Req() req: Request) {
    return this.telegram.getConnection(req.paymodUser!.account.id);
  }

  @Delete()
  @UseGuards(SessionGuard)
  async disconnect(@Req() req: Request) {
    await this.telegram.disconnect(req.paymodUser!.account.id);
    return { ok: true };
  }

  @Post("webhook")
  webhook(@Headers("x-telegram-bot-api-secret-token") secret: string | undefined, @Body() body: unknown) {
    return this.telegram.handleWebhook(secret, body).then(() => ({ ok: true }));
  }
}
