import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { PrismaService } from "./prisma.service.js";
import { isCredentialMatch, getCredentialPrefix, CODE_CREDENTIAL_PREFIX } from "./credentials.js";
import type { AuthenticatedWallet } from "./wallet-credential.guard.js";

/**
 * Authenticates the `pmcode_...` credential from the device-auth flow.
 * Deliberately a separate table/guard from `WalletCredentialGuard` so a
 * coding session structurally can't authenticate a financial endpoint
 * (the prefix check alone rules it out). Accepts both `x-api-key` and
 * `Authorization: Bearer` since the inference proxy is reached by
 * whichever wire format the client speaks.
 */
@Injectable()
export class CodeCredentialGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const secret = extractCredential(req);
    if (!secret || !secret.startsWith(CODE_CREDENTIAL_PREFIX)) {
      throw new UnauthorizedException("Missing or malformed credential");
    }

    const credential = await this.authenticate(secret);
    await this.prisma.codeCredential.update({ where: { id: credential.id }, data: { lastUsedAt: new Date() } });

    req.paymod = { account: credential.wallet.account, wallet: credential.wallet, credentialId: credential.id } satisfies AuthenticatedWallet;
    return true;
  }

  private async authenticate(secret: string) {
    const credential = await this.prisma.codeCredential.findUnique({
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

function extractCredential(req: Request): string | undefined {
  const apiKeyHeader = req.headers["x-api-key"];
  if (typeof apiKeyHeader === "string") return apiKeyHeader;

  const authorization = req.headers.authorization;
  if (authorization?.startsWith("Bearer ")) return authorization.slice("Bearer ".length).trim();

  return undefined;
}
