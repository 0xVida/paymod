import { cookies } from "next/headers";
import { api, ApiError } from "./api";

export type AccountSummary = { accountId: string; accountName: string };
export type AuthenticatedUser = { id: string; email: string; name: string };
export type MeResponse = { user: AuthenticatedUser; account: AccountSummary; isAdmin: boolean };

/**
 * forwards the incoming request's cookie header since server-side `fetch`
 * has no browser cookie jar of its own. treats any failure (401, timeout,
 * 5xx, API down) as logged-out rather than throwing, so public pages never
 * crash from an API outage - errors are still logged for real misconfigs.
 */
export async function getSession(): Promise<MeResponse | null> {
  const cookieStore = await cookies();
  try {
    return await api.get<MeResponse>("/v1/auth/me", { cookie: cookieStore.toString() });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    console.error("getSession: treating as logged out after an unexpected error", error);
    return null;
  }
}
