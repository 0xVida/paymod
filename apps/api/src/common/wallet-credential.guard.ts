import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import type { Account, AgentWallet } from "@paymod/database";
import { PrismaService } from "./prisma.service.js";
import { isCredentialMatch, getCredentialPrefix } from "./credentials.js";
import { getOAuthSecretPrefix, isOAuthSecretMatch } from "../auth/oauth-tokens.js";

export type AuthenticatedWallet = { account: Account; wallet: AgentWallet; credentialId: string };

declare module "express" {
  interface Request {
    paymod?: AuthenticatedWallet;
  }
}

/**
 * Authenticates the `pm_live_...` bearer credential. Deliberately does NOT
 * reject a paused wallet or a suspended account here: those produce a
 * clean policy DENY (see @paymod/policy-engine), not a bare 401. This guard
 * only answers "is this credential real and unrevoked".
 */
@Injectable()
export class WalletCredentialGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const secret = extractBearerToken(req.headers.authorization);
    if (!secret) {
      throw new UnauthorizedException("Missing or malformed credential");
    }

    if (secret.startsWith("pma_")) return this.authenticateOAuthToken(secret, req);
    if (!secret.startsWith("pm_live_")) throw new UnauthorizedException("Missing or malformed credential");

    const credential = await this.authenticate(secret);
    await this.prisma.walletCredential.update({
      where: { id: credential.id },
      data: { lastUsedAt: new Date() },
    });

    req.paymod = {
      account: credential.wallet.account,
      wallet: credential.wallet,
      credentialId: credential.id,
    };
    return true;
  }

  private async authenticateOAuthToken(secret: string, req: Request): Promise<boolean> {
    const token = await this.prisma.oAuthToken.findUnique({
      where: { accessTokenPrefix: getOAuthSecretPrefix(secret) },
      include: { wallet: { include: { account: true } } },
    });
    if (!token || token.revokedAt || token.expiresAt < new Date() || !isOAuthSecretMatch(secret, token.accessTokenHash)) {
      throw new UnauthorizedException("Invalid access token");
    }
    if (token.resource !== process.env.PAYMOD_MCP_RESOURCE_URL) throw new UnauthorizedException("Invalid access token");
    req.paymod = { account: token.wallet.account, wallet: token.wallet, credentialId: token.id };
    return true;
  }

  private async authenticate(secret: string) {
    const credential = await this.prisma.walletCredential.findUnique({
      where: { prefix: getCredentialPrefix(secret) },
      include: { wallet: { include: { account: true } } },
    });
    if (!credential || credential.revokedAt || (credential.expiresAt && credential.expiresAt < new Date())) {
      throw new UnauthorizedException("Invalid credential");
    }
    if (!isCredentialMatch(secret, credential.hash)) {
      throw new UnauthorizedException("Invalid credential");
    }
    return credential;
  }
}

function extractBearerToken(header: string | undefined): string | undefined {
  if (!header?.startsWith("Bearer ")) return undefined;
  return header.slice("Bearer ".length).trim();
}
