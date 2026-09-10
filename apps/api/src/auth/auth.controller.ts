import { Body, Controller, Get, Post, Req, Res, UseGuards, UsePipes } from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { SessionGuard } from "../common/session.guard.js";
import { AuthService } from "./auth.service.js";
import { SESSION_COOKIE } from "./resolve-session.js";

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

@Controller("v1/auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("signup")
  @UsePipes(new ZodValidationPipe(signupSchema))
  async signup(@Body() body: z.infer<typeof signupSchema>, @Res({ passthrough: true }) res: Response) {
    const { token, expiresAt, user } = await this.auth.signup(body.email, body.password, body.name);
    setSessionCookie(res, token, expiresAt);
    return { user };
  }

  @Post("login")
  @UsePipes(new ZodValidationPipe(loginSchema))
  async login(@Body() body: z.infer<typeof loginSchema>, @Res({ passthrough: true }) res: Response) {
    const { token, expiresAt, user } = await this.auth.login(body.email, body.password);
    setSessionCookie(res, token, expiresAt);
    return { user };
  }

  @Post("logout")
  @UseGuards(SessionGuard)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.paymodUser!.sessionId);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  }

  @Get("me")
  @UseGuards(SessionGuard)
  async me(@Req() req: Request) {
    return this.auth.me(req.paymodUser!.user.id);
  }
}

function setSessionCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
    path: "/",
  });
}
