import { Body, Controller, Delete, Get, Headers, Param, Post, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { SessionGuard } from "../common/session.guard.js";
import { OAuthService } from "./oauth.service.js";

const registrationSchema = z.object({ client_name: z.string().min(1).max(200).optional(), redirect_uris: z.array(z.string().url()).min(1) });
const authorizeSchema = z.object({ client_id: z.string().min(1), redirect_uri: z.string().url(), code_challenge: z.string().min(43), code_challenge_method: z.literal("S256"), resource: z.string().url(), scope: z.string().optional(), wallet_id: z.string().min(1), state: z.string().min(1).optional() });
const tokenSchema = z.discriminatedUnion("grant_type", [z.object({ grant_type: z.literal("authorization_code"), code: z.string().min(1), client_id: z.string().min(1), redirect_uri: z.string().url(), code_verifier: z.string().min(43), resource: z.string().url() }), z.object({ grant_type: z.literal("refresh_token"), refresh_token: z.string().min(1), client_id: z.string().min(1), resource: z.string().url() })]);
const introspectionSchema = z.object({ token: z.string().min(1) });

@Controller("v1/oauth")
export class OAuthController {
  constructor(private readonly oauth: OAuthService) {}

  @Post("register")
  register(@Body(new ZodValidationPipe(registrationSchema)) body: z.infer<typeof registrationSchema>) {
    return this.oauth.registerClient(body.client_name, body.redirect_uris);
  }

  @Post("authorize")
  @UseGuards(SessionGuard)
  async authorize(@Req() request: Request, @Body(new ZodValidationPipe(authorizeSchema)) body: z.infer<typeof authorizeSchema>) {
    const code = await this.oauth.authorize(request.paymodUser!.account.id, body.wallet_id, { clientId: body.client_id, redirectUri: body.redirect_uri, codeChallenge: body.code_challenge, resource: body.resource, scope: body.scope });
    const callback = new URL(body.redirect_uri);
    callback.searchParams.set("code", code);
    if (body.state) callback.searchParams.set("state", body.state);
    return { redirect_uri: callback.toString() };
  }

  @Post("token")
  exchange(@Body(new ZodValidationPipe(tokenSchema)) body: z.infer<typeof tokenSchema>) {
    if (body.grant_type === "authorization_code") return this.oauth.exchangeCode(body.code, body.client_id, body.redirect_uri, body.code_verifier, body.resource);
    return this.oauth.refresh(body.refresh_token, body.client_id, body.resource);
  }

  @Post("introspect")
  async introspect(
    @Headers("x-paymod-mcp-secret") secret: string | undefined,
    @Body(new ZodValidationPipe(introspectionSchema)) body: z.infer<typeof introspectionSchema>,
  ) {
    if (secret !== requireEnv("PAYMOD_MCP_INTROSPECTION_SECRET")) throw new UnauthorizedException();
    const token = await this.oauth.resolveAccessToken(body.token);
    return token ? { active: true, scope: token.scope, client_id: token.clientId, resource: token.resource, exp: Math.floor(token.expiresAt.getTime() / 1000) } : { active: false };
  }

  @Get("connections")
  @UseGuards(SessionGuard)
  connections(@Req() request: Request) {
    return this.oauth.listConnections(request.paymodUser!.account.id);
  }

  @Delete("connections/:id")
  @UseGuards(SessionGuard)
  async revokeConnection(@Req() request: Request, @Param("id") id: string) {
    await this.oauth.revokeConnection(request.paymodUser!.account.id, id);
    return { ok: true };
  }
}

@Controller()
export class OAuthMetadataController {
  @Get(".well-known/oauth-authorization-server")
  metadata() {
    const issuer = requireEnv("PAYMOD_OAUTH_ISSUER");
    return { issuer, authorization_endpoint: `${requireEnv("PAYMOD_WEB_URL")}/oauth/authorize`, token_endpoint: `${issuer}/v1/oauth/token`, registration_endpoint: `${issuer}/v1/oauth/register`, response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], token_endpoint_auth_methods_supported: ["none"], code_challenge_methods_supported: ["S256"], scopes_supported: ["mcp:tools", "offline_access"] };
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
