import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { PrismaService } from "./prisma.service.js";
import { resolveSession, touchSession } from "../auth/resolve-session.js";
import type { AuthenticatedSession } from "./session.guard.js";

const RECENT_AUTH_MAX_AGE_MS = 15 * 60 * 1000;

/** bound to the stable user id, not email - an email can be changed by the account holder, the id can't. Exported so `AuthService.me()` can tell the dashboard whether to show admin navigation at all, without duplicating the allowlist parsing. */
export function isAdminUserId(userId: string): boolean {
  const allowlist = (process.env.ADMIN_USER_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  return allowlist.includes(userId);
}

/**
 * no new Role/Staff/RBAC system for one protocol operator: an admin is a
 * signed-in `User` whose id is in an env-var allowlist, reusing
 * `SessionGuard`'s own session-resolution entirely.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const session = await resolveSession(this.prisma, req);
    if (!session) throw new UnauthorizedException("Not signed in");
    if (!isAdminUserId(session.user.id)) throw new ForbiddenException("Not an admin");

    touchSession(this.prisma, session.id);
    req.paymodUser = { sessionId: session.id, user: session.user, account: session.user.account! } satisfies AuthenticatedSession;
    return true;
  }
}

/**
 * Sensitive admin actions (add, revoke or rotate a provider key) require a
 * session issued recently, not merely valid, so an old stolen browser
 * session can't silently rotate credentials. Checked against
 * `session.createdAt`, never `lastUsedAt` (every request touches that and
 * would defeat the check). Re-resolves the session rather than trusting
 * `req.paymodUser`, which `AdminGuard` populates without `createdAt`.
 */
export async function requireRecentAuth(prisma: PrismaService, req: Request, maxAgeMs = RECENT_AUTH_MAX_AGE_MS): Promise<void> {
  const session = await resolveSession(prisma, req);
  if (!session) throw new UnauthorizedException("Not signed in");
  if (Date.now() - session.createdAt.getTime() > maxAgeMs) {
    throw new ForbiddenException("Re-authenticate to perform this action");
  }
}
