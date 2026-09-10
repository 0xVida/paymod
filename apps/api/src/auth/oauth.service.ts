import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import { newId } from "@paymod/shared";
import { PrismaService } from "../common/prisma.service.js";
import { createCodeChallenge, generateOAuthSecret, getOAuthSecretPrefix, hashOAuthSecret, isOAuthSecretMatch } from "./oauth-tokens.js";

const CODE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TTL_MS = 60 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MCP_SCOPE = "mcp:tools";

type AuthorizeInput = { clientId: string; redirectUri: string; codeChallenge: string; resource: string; scope?: string };

@Injectable()
export class OAuthService {
  constructor(private readonly prisma: PrismaService) {}

  async registerClient(name: string | undefined, redirectUris: string[]) {
    if (!redirectUris.length || redirectUris.some((uri) => !isSecureRedirectUri(uri))) {
      throw new BadRequestException("redirect_uris must contain HTTPS URLs");
    }
    const client = await this.prisma.oAuthClient.create({
      data: { id: newId("oauthClient"), name, redirectUris },
    });
    return { client_id: client.id, client_name: client.name, redirect_uris: redirectUris, token_endpoint_auth_method: "none" };
  }

  async authorize(accountId: string, walletId: string, input: AuthorizeInput): Promise<string> {
    const client = await this.prisma.oAuthClient.findUnique({ where: { id: input.clientId } });
    if (!client || !hasRedirectUri(client.redirectUris, input.redirectUri)) throw new BadRequestException("Invalid OAuth client");
    if (!input.codeChallenge || input.codeChallenge.length < 43) throw new BadRequestException("PKCE S256 is required");
    if (!input.resource || input.resource !== requireEnv("PAYMOD_MCP_RESOURCE_URL")) throw new BadRequestException("Invalid resource");

    const wallet = await this.prisma.agentWallet.findFirst({ where: { id: walletId, accountId, status: "ACTIVE" } });
    if (!wallet) throw new BadRequestException("Choose an active wallet");
    const scope = normalizeScope(input.scope);
    const code = generateOAuthSecret("poc");
    await this.prisma.oAuthAuthorizationCode.create({
      data: { id: newId("oauthCode"), codeHash: hashOAuthSecret(code), clientId: client.id, walletId, redirectUri: input.redirectUri, scope, resource: input.resource, codeChallenge: input.codeChallenge, expiresAt: new Date(Date.now() + CODE_TTL_MS) },
    });
    return code;
  }

  async exchangeCode(code: string, clientId: string, redirectUri: string, verifier: string, resource: string) {
    const row = await this.prisma.oAuthAuthorizationCode.findUnique({ where: { codeHash: hashOAuthSecret(code) } });
    if (!row || row.consumedAt || row.expiresAt < new Date() || row.clientId !== clientId || row.redirectUri !== redirectUri || row.resource !== resource || createCodeChallenge(verifier) !== row.codeChallenge) {
      throw new UnauthorizedException("Invalid authorization code");
    }
    const consumed = await this.prisma.oAuthAuthorizationCode.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (consumed.count !== 1) throw new UnauthorizedException("Authorization code already used");
    return this.createToken(row.clientId, row.walletId, row.scope, row.resource);
  }

  async refresh(refreshToken: string, clientId: string, resource: string) {
    const row = await this.prisma.oAuthToken.findUnique({ where: { refreshTokenPrefix: getOAuthSecretPrefix(refreshToken) } });
    if (!row || row.revokedAt || row.refreshExpiresAt < new Date() || row.clientId !== clientId || row.resource !== resource || !isOAuthSecretMatch(refreshToken, row.refreshTokenHash)) {
      throw new UnauthorizedException("Invalid refresh token");
    }
    await this.prisma.oAuthToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    return this.createToken(row.clientId, row.walletId, row.scope, row.resource);
  }

  async resolveAccessToken(accessToken: string) {
    const row = await this.prisma.oAuthToken.findUnique({ where: { accessTokenPrefix: getOAuthSecretPrefix(accessToken) }, include: { wallet: { include: { account: true } } } });
    if (!row || row.revokedAt || row.expiresAt < new Date() || row.resource !== requireEnv("PAYMOD_MCP_RESOURCE_URL") || !isOAuthSecretMatch(accessToken, row.accessTokenHash)) return undefined;
    return row;
  }

  async listConnections(accountId: string) {
    return this.prisma.oAuthToken.findMany({
      where: { wallet: { accountId }, revokedAt: null },
      include: { client: true, wallet: true },
      orderBy: { createdAt: "desc" },
    }).then((tokens) => tokens.map((token) => ({
      id: token.id,
      clientName: token.client.name ?? "Unnamed MCP client",
      walletName: token.wallet.name,
      createdAt: token.createdAt,
      expiresAt: token.expiresAt,
    })));
  }

  async revokeConnection(accountId: string, tokenId: string) {
    const updated = await this.prisma.oAuthToken.updateMany({
      where: { id: tokenId, revokedAt: null, wallet: { accountId } },
      data: { revokedAt: new Date() },
    });
    if (updated.count !== 1) throw new BadRequestException("MCP connection not found or already revoked");
  }

  private async createToken(clientId: string, walletId: string, scope: string, resource: string) {
    const accessToken = generateOAuthSecret("pma");
    const refreshToken = generateOAuthSecret("pmr");
    await this.prisma.oAuthToken.create({ data: { id: newId("oauthToken"), accessTokenHash: hashOAuthSecret(accessToken), accessTokenPrefix: getOAuthSecretPrefix(accessToken), refreshTokenHash: hashOAuthSecret(refreshToken), refreshTokenPrefix: getOAuthSecretPrefix(refreshToken), clientId, walletId, scope, resource, expiresAt: new Date(Date.now() + ACCESS_TTL_MS), refreshExpiresAt: new Date(Date.now() + REFRESH_TTL_MS) } });
    return { access_token: accessToken, token_type: "Bearer", expires_in: ACCESS_TTL_MS / 1000, refresh_token: refreshToken, scope };
  }
}

function normalizeScope(scope: string | undefined): string {
  const scopes = new Set((scope ?? "").split(" ").filter(Boolean));
  if (!scopes.has(MCP_SCOPE)) throw new BadRequestException("mcp:tools scope is required");
  for (const value of scopes) if (value !== MCP_SCOPE && value !== "offline_access") throw new BadRequestException("Unsupported OAuth scope");
  return [...scopes].sort().join(" ");
}

function hasRedirectUri(value: unknown, redirectUri: string): boolean {
  return Array.isArray(value) && value.includes(redirectUri);
}

function isSecureRedirectUri(value: string): boolean {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
