import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { PrismaService } from "./prisma.service.js";
import { resolveSession, touchSession } from "../auth/resolve-session.js";

/**
 * accepts either the operator bootstrap token (CLI/ops flows) or a
 * signed-in session whose account matches the `accountId` in the request.
 * This is the actual RBAC enforcement point: a valid session proves who
 * the caller is, not that they may act on the account named in the
 * request.
 *
 * One guard, not an owner/member split, because ADR 0009 dropped the team
 * model: an account has exactly one user, so read and write access
 * collapse to the same question.
 */
@Injectable()
export class BootstrapOrAccountGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    if (matchesBootstrapToken(req)) return true;
    return this.matchesAccountSession(req);
  }

  private async matchesAccountSession(req: Request): Promise<boolean> {
    const session = await resolveSession(this.prisma, req);
    if (!session) throw new UnauthorizedException("Not signed in");

    // every user has exactly one account, created atomically at signup
    // (AuthService.signup). Prisma types the back-relation as nullable
    // because it can't see that application-level guarantee.
    const account = session.user.account!;
    const accountId = accountIdFromRequest(req);
    if (account.id !== accountId) throw new ForbiddenException("No access to this account");

    touchSession(this.prisma, session.id);
    req.paymodUser = { sessionId: session.id, user: session.user, account };
    return true;
  }
}

function matchesBootstrapToken(req: Request): boolean {
  const token = process.env.PAYMOD_BOOTSTRAP_TOKEN;
  return !!token && req.headers.authorization === `Bearer ${token}`;
}

function accountIdFromRequest(req: Request): string | undefined {
  const body = req.body as { accountId?: string } | undefined;
  return body?.accountId ?? (req.query["accountId"] as string | undefined) ?? (req.params["accountId"] as string | undefined);
}
