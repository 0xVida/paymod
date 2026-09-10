const API_URL =
  process.env["PAYMOD_API_URL"] ?? process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001";
const BROWSER_API_URL = "/api";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

type RequestOptions = { cookie?: string };

/** browser calls send credentials automatically - server components pass the incoming request's cookie header instead, via `cookie`. */
async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (options?.cookie) headers["cookie"] = options.cookie;

  const baseUrl = typeof window === "undefined" ? API_URL : BROWSER_API_URL;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    credentials: "include",
    cache: "no-store",
    headers,
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });

  if (!res.ok) {
    throw await toApiError(res);
  }
  const responseBody = await res.text();
  return responseBody ? (JSON.parse(responseBody) as T) : (null as T);
}

async function toApiError(res: Response): Promise<ApiError> {
  const payload = (await res.json().catch(() => undefined)) as
    | { error?: { code?: string; message?: string; details?: unknown }; message?: string }
    | undefined;
  const message = payload?.error?.message ?? payload?.message ?? `Request failed (${res.status})`;
  const code = payload?.error?.code ?? "REQUEST_FAILED";
  return new ApiError(code, message, res.status, payload?.error?.details);
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>("GET", path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>("POST", path, body, options),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>("PUT", path, body, options),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>("PATCH", path, body, options),
  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>("DELETE", path, undefined, options),
};

/**
 * a network failure (unreachable, DNS, timeout) throws a `TypeError` from
 * `fetch()` itself, never an `ApiError` - the two need different messages
 * since only `ApiError` is the API's own answer. any other `Error` still
 * shows its own message.
 */
export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    const issues = (
      err.details as { issues?: { path?: PropertyKey[]; message?: string }[] } | undefined
    )?.issues;
    if (issues?.length) {
      return `${err.message} ${issues
        .map(
          (issue) => `${issue.path?.join(".") || "request"}: ${issue.message ?? "Invalid value"}`,
        )
        .join("; ")}`;
    }
    return err.message;
  }
  if (err instanceof TypeError)
    return "Can't reach the Paymod API right now. Please try again shortly.";
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}
