import { ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { newId } from "@paymod/shared";
import { PrismaService } from "../common/prisma.service.js";
import { hashPassword, isPasswordMatch } from "./password.js";
import { generateSessionToken } from "./session-token.js";
import { LoginRateLimiter } from "./login-rate-limiter.js";
import { AuditService } from "../audit/audit.service.js";
import { isAdminUserId } from "../common/admin.guard.js";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export type AuthenticatedUser = { id: string; email: string; name: string };
export type AccountSummary = { accountId: string; accountName: string };
export type SessionResult = { token: string; expiresAt: Date; user: AuthenticatedUser };

/**
 * one account per user (ADR 0009 Decision 1): signup never asks
 * "individual or team" and there is no membership to create. Matches
 * `IntentsService`'s transactional style for multi-row writes.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly loginRateLimiter: LoginRateLimiter,
    private readonly audit: AuditService,
  ) {}

  async signup(email: string, password: string, name: string): Promise<SessionResult> {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException("An account with this email already exists");

    const passwordHash = await hashPassword(password);
    const userId = newId("user");
    const accountId = newId("account");

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({ data: { id: userId, email, passwordHash, name } });
      await tx.account.create({ data: { id: accountId, userId, name: `${name}'s account` } });
      await this.audit.record(
        { accountId, actorType: "USER", actorId: userId, action: "ACCOUNT_CREATED", targetType: "account", targetId: accountId },
        tx,
      );
      return created;
    });

    return this.createSession(user);
  }

  async login(email: string, password: string): Promise<SessionResult> {
    this.loginRateLimiter.checkAndRecord(email);

    const user = await this.prisma.user.findUnique({ where: { email }, include: { account: true } });
    if (!user || !(await isPasswordMatch(password, user.passwordHash))) {
      throw new UnauthorizedException("Invalid email or password");
    }

    this.loginRateLimiter.reset(email);
    await this.audit.record({
      accountId: user.account!.id,
      actorType: "USER",
      actorId: user.id,
      action: "USER_LOGGED_IN",
    });
    return this.createSession(user);
  }

  async logout(sessionId: string): Promise<void> {
    await this.prisma.session.delete({ where: { id: sessionId } }).catch(() => undefined);
  }

  async me(userId: string): Promise<{ user: AuthenticatedUser; account: AccountSummary; isAdmin: boolean }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { account: true } });
    return {
      user: toAuthenticatedUser(user),
      account: { accountId: user.account!.id, accountName: user.account!.name },
      isAdmin: isAdminUserId(user.id),
    };
  }

  private async createSession(user: { id: string; email: string; name: string }): Promise<SessionResult> {
    const { token, prefix, hash } = generateSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.prisma.session.create({ data: { id: newId("session"), userId: user.id, prefix, hash, expiresAt } });
    return { token, expiresAt, user: toAuthenticatedUser(user) };
  }
}

function toAuthenticatedUser(user: { id: string; email: string; name: string }): AuthenticatedUser {
  return { id: user.id, email: user.email, name: user.name };
}
