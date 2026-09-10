import { Body, Controller, Post, Req, UseGuards, UsePipes } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { SessionGuard } from "../common/session.guard.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { DeviceAuthService } from "./device-auth.service.js";

const pollSchema = z.object({ deviceCode: z.string().min(1) });
const userCodeSchema = z.object({ userCode: z.string().min(1) });

/**
 * Device-code auth for the Paymod Code extension, which has no browser
 * session of its own. `start`/`poll` are unauthenticated (the device code
 * itself is the bearer secret); `approve`/`deny` run under the browser's
 * existing session so a signed-in human is the one linking the pending
 * request to their account.
 */
@Controller("v1/code/device")
export class DeviceAuthController {
  constructor(private readonly deviceAuth: DeviceAuthService) {}

  @Post("start")
  start() {
    return this.deviceAuth.start();
  }

  @Post("poll")
  @UsePipes(new ZodValidationPipe(pollSchema))
  poll(@Body() body: z.infer<typeof pollSchema>) {
    return this.deviceAuth.poll(body.deviceCode);
  }

  @Post("approve")
  @UseGuards(SessionGuard)
  @UsePipes(new ZodValidationPipe(userCodeSchema))
  async approve(@Req() req: Request, @Body() body: z.infer<typeof userCodeSchema>) {
    await this.deviceAuth.approve(req.paymodUser!.account.id, body.userCode);
    return { status: "approved" };
  }

  @Post("deny")
  @UseGuards(SessionGuard)
  @UsePipes(new ZodValidationPipe(userCodeSchema))
  async deny(@Req() req: Request, @Body() body: z.infer<typeof userCodeSchema>) {
    await this.deviceAuth.deny(req.paymodUser!.account.id, body.userCode);
    return { status: "denied" };
  }
}
