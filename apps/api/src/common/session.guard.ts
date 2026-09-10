import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import type { Account, User } from "@paymod/database";
import { PrismaService } from "./prisma.service.js";
import { resolveSession, touchSession } from "../auth/resolve-session.js";

export type AuthenticatedSession = { sessionId: string; user: User; account: Account };

declare module "express" {
  interface Request {
    paymodUser?: AuthenticatedSession;
  }
}

/** any signed-in user. See `BootstrapOrAccountGuard` for write access to that user's account. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const session = await resolveSession(this.prisma, req);
    if (!session) throw new UnauthorizedException("Not signed in");

    touchSession(this.prisma, session.id);
    // every user has exactly one account, created atomically at signup
    // (AuthService.signup). Prisma types the back-relation as nullable
    // because it can't see that application-level guarantee.
    req.paymodUser = { sessionId: session.id, user: session.user, account: session.user.account! };
    return true;
  }
}
