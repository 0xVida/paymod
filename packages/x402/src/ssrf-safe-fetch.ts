import { lookup as dnsLookup } from "node:dns";
import { isIP } from "node:net";
import { Agent, Headers, fetch as undiciFetch, type Dispatcher, type RequestInit, type Response } from "undici";
import { ERROR_CODES, PaymodError } from "@paymod/shared";

const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
// `payment-signature` carries the already-signed x402 transaction XDR
// (payment-payload.ts): leaking it on a cross-origin redirect hands a
// malicious merchant a valid signed transaction, not just a credential.
const SENSITIVE_HEADERS = ["authorization", "cookie", "payment-signature"];

function isPrivateOrReservedIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return true; // "this" network
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, includes the 169.254.169.254 cloud metadata endpoint
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT, RFC6598
  if (a === 192 && b === 0 && parts[2] === 2) return true; // TEST-NET-1
  if (a >= 224) return true; // multicast and reserved (224.0.0.0/4, 240.0.0.0/4), broadcast
  return false;
}

function isPrivateOrReservedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true; // loopback / unspecified
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true; // link-local fe80::/10
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true; // unique local fc00::/7
  if (lower.startsWith("::ffff:")) {
    const embedded = lower.slice("::ffff:".length);
    return isIP(embedded) === 4 ? isPrivateOrReservedIPv4(embedded) : true;
  }
  return false;
}

/** exported for direct unit testing: the security-critical part of this module. */
export function isUnsafeAddress(address: string, family: number): boolean {
  return family === 4 ? isPrivateOrReservedIPv4(address) : isPrivateOrReservedIPv6(address);
}

/**
 * resolves DNS itself and returns only addresses that already passed the
 * check: those are what the TCP socket actually connects to (undici's
 * `connect.lookup` feeds directly into `net.connect`), so the validated
 * IP is pinned into the connection rather than re-resolved later.
 * Re-checking the hostname instead of the pinned IP at connect time
 * wouldn't defeat DNS rebinding.
 *
 * Must honor `options.all`: Node's `autoSelectFamily` (Happy Eyeballs, on
 * by default) calls this with `all: true` expecting an address array
 * back; always returning the single-address form makes net.js read
 * `undefined` out of what it expects to be an array and throw
 * `ERR_INVALID_IP_ADDRESS`.
 */
function pinnedLookup(
  hostname: string,
  options: { all?: boolean | undefined },
  callback: (err: NodeJS.ErrnoException | null, address: string | { address: string; family: number }[], family?: number) => void,
): void {
  dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) {
      callback(err, "");
      return;
    }
    const safe = addresses.filter((candidate) => !isUnsafeAddress(candidate.address, candidate.family));
    if (safe.length === 0) {
      callback(new Error(`SSRF_BLOCKED: ${hostname} resolves only to private/reserved addresses`), "");
      return;
    }
    if (options.all === true) {
      callback(null, safe);
      return;
    }
    callback(null, safe[0]!.address, safe[0]!.family);
  });
}

/**
 * A rejection from inside `pinnedLookup` doesn't surface as itself:
 * undici's connector wraps it deep in the socket-connect path, with the
 * real reason reachable only through `.cause` (possibly nested) or, when
 * Happy Eyeballs races multiple addresses, inside
 * `AggregateError.errors[]`. Unwrapped, that reaches the caller as an
 * opaque error instead of `PaymodError(SSRF_BLOCKED)` for exactly the
 * case that matters most: a hostname resolving to localhost or a
 * metadata IP, which `assertFetchableUrl` can't catch upfront since
 * it's not a literal IP.
 */
async function tryFetch(url: URL, init: RequestInit): Promise<Response> {
  try {
    return await undiciFetch(url, init);
  } catch (error) {
    const message = findSsrfBlockedMessage(error);
    if (message) throw new PaymodError(ERROR_CODES.SSRF_BLOCKED, message);
    throw error;
  }
}

function findSsrfBlockedMessage(error: unknown, depth = 0): string | undefined {
  if (depth > 5 || !(error instanceof Error)) return undefined;
  if (error.message.includes("SSRF_BLOCKED")) return error.message;
  if (error instanceof AggregateError) {
    for (const inner of error.errors) {
      const found = findSsrfBlockedMessage(inner, depth + 1);
      if (found) return found;
    }
  }
  return findSsrfBlockedMessage(error.cause, depth + 1);
}

function assertFetchableUrl(url: URL): void {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new PaymodError(ERROR_CODES.SSRF_BLOCKED, `Unsupported URL scheme: ${url.protocol}`);
  }
  const ipVersion = isIP(url.hostname);
  if (ipVersion !== 0 && isUnsafeAddress(url.hostname, ipVersion)) {
    throw new PaymodError(ERROR_CODES.SSRF_BLOCKED, `Refusing to fetch a literal private/reserved address: ${url.hostname}`);
  }
}

/** exported for direct unit testing, same reason as `isUnsafeAddress`: `ssrfSafeFetch` itself refuses to fetch localhost/private addresses, so a real redirect can't be exercised end-to-end in tests. */
export function stripSensitiveHeaders(headers: Headers): Headers {
  const stripped = new Headers(headers);
  for (const name of SENSITIVE_HEADERS) stripped.delete(name);
  return stripped;
}

/**
 * A fetch safe to call with a merchant-supplied URL: resolves DNS itself,
 * rejects private/reserved/loopback/link-local/CGNAT/metadata-range
 * addresses (IPv4 and IPv6, including IPv4-mapped IPv6), pins the
 * validated address into the TCP connection, and follows redirects
 * manually, re-running every check on each hop rather than trusting
 * undici's default follower. `Authorization`/`Cookie`/
 * `PAYMENT-SIGNATURE` are stripped whenever a redirect crosses origins.
 */
export async function ssrfSafeFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const dispatcher: Dispatcher = new Agent({ connect: { lookup: pinnedLookup } });
  // `close()` drains the in-flight request rather than aborting it; safe
  // to fire without awaiting since a fresh Agent is created per call and
  // never reused. Without this, every call leaks its own connection pool
  // under sustained x402 traffic.
  try {
    let url = new URL(input);
    let headers = new Headers(init.headers);
    let method = init.method ?? "GET";
    let body = init.body;

    for (let hop = 0; ; hop++) {
      assertFetchableUrl(url);
      const response = await tryFetch(url, {
        ...init,
        method,
        headers,
        ...(body !== undefined && { body }),
        redirect: "manual",
        dispatcher,
      });

      if (!REDIRECT_STATUSES.has(response.status)) {
        return response;
      }
      if (hop >= MAX_REDIRECTS) {
        throw new PaymodError(ERROR_CODES.SSRF_BLOCKED, `Exceeded ${MAX_REDIRECTS} redirects fetching ${input}`);
      }
      const location = response.headers.get("location");
      if (!location) {
        throw new PaymodError(ERROR_CODES.SSRF_BLOCKED, "Redirect response is missing a Location header");
      }
      const next = new URL(location, url);
      if (next.origin !== url.origin) {
        headers = stripSensitiveHeaders(headers);
      }
      // A 303 (and, per convention, most 301/302 handling) converts to GET; a
      // 307/308 must preserve the original method and body.
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && method !== "GET")) {
        method = "GET";
        body = undefined;
      }
      url = next;
    }
  } finally {
    void dispatcher.close().catch(() => undefined);
  }
}
