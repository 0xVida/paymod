import type { Request } from "express";

/**
 * `BootstrapOrOwnerGuard`/`BootstrapOrMemberGuard` only set `req.paymodUser`
 * on the session branch: a bootstrap-token caller is a real actor too, just
 * not a specific user, so it's recorded as `SYSTEM` rather than omitted.
 */
export function actorFromRequest(req: Request): { actorType: "USER" | "SYSTEM"; actorId?: string } {
  return req.paymodUser ? { actorType: "USER", actorId: req.paymodUser.user.id } : { actorType: "SYSTEM" };
}
