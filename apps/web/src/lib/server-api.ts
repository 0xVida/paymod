import { cookies } from "next/headers";
import { api } from "./api";

/** server-component GET, forwarding the incoming request's session cookie */
export async function serverGet<T>(path: string): Promise<T> {
  const cookieStore = await cookies();
  return api.get<T>(path, { cookie: cookieStore.toString() });
}
