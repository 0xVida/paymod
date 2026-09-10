import type { Request } from "express";
import type { PrismaClient } from "@paymod/database";
import { getSessionTokenPrefix, isSessionTokenMatch } from "./session-token.js";

export const SESSION_COOKIE = "paymod_session";

export type ResolvedSession = Awaited<ReturnType<typeof loadSession>>;

/** shared by every guard that accepts a session: looks up, validates expiry and verifies the token in one place. */
export async function resolveSession(prisma: PrismaClient, req: Request) {
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (!token || !token.startsWith("pcs_")) return undefined;

  const session = await loadSession(prisma, token);
  if (!session || session.expiresAt < new Date() || !isSessionTokenMatch(token, session.hash)) {
    return undefined;
  }
  return session;
}

function loadSession(prisma: PrismaClient, token: string) {
  return prisma.session.findUnique({
    where: { prefix: getSessionTokenPrefix(token) },
    include: { user: { include: { account: true } } },
  });
}

export function touchSession(prisma: PrismaClient, sessionId: string): void {
  void prisma.session.update({ where: { id: sessionId }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
}
