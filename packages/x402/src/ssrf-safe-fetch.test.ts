import test from "node:test";
import assert from "node:assert/strict";
import { Headers } from "undici";
import { ERROR_CODES, PaymodError } from "@paymod/shared";
import { isUnsafeAddress, ssrfSafeFetch, stripSensitiveHeaders } from "./ssrf-safe-fetch.js";

function isSsrfBlocked(error: unknown): boolean {
  return error instanceof PaymodError && error.code === ERROR_CODES.SSRF_BLOCKED;
}

test("IPv4 loopback, RFC1918, link-local, CGNAT and multicast are all unsafe", () => {
  assert.equal(isUnsafeAddress("127.0.0.1", 4), true);
  assert.equal(isUnsafeAddress("10.0.0.1", 4), true);
  assert.equal(isUnsafeAddress("172.16.0.1", 4), true);
  assert.equal(isUnsafeAddress("172.31.255.255", 4), true);
  assert.equal(isUnsafeAddress("192.168.1.1", 4), true);
  assert.equal(isUnsafeAddress("169.254.169.254", 4), true, "cloud metadata endpoint must be blocked");
  assert.equal(isUnsafeAddress("100.64.0.1", 4), true, "CGNAT range must be blocked");
  assert.equal(isUnsafeAddress("224.0.0.1", 4), true, "multicast must be blocked");
  assert.equal(isUnsafeAddress("0.0.0.0", 4), true);
});

test("a normal public IPv4 address is safe", () => {
  assert.equal(isUnsafeAddress("93.184.216.34", 4), false);
  assert.equal(isUnsafeAddress("8.8.8.8", 4), false);
});

test("IPv4 addresses just outside a blocked range are safe", () => {
  assert.equal(isUnsafeAddress("172.15.255.255", 4), false, "just below the RFC1918 172.16/12 block");
  assert.equal(isUnsafeAddress("172.32.0.0", 4), false, "just above the RFC1918 172.16/12 block");
  assert.equal(isUnsafeAddress("169.253.255.255", 4), false, "just below the 169.254/16 link-local block");
});

test("IPv6 loopback, link-local and unique-local are unsafe", () => {
  assert.equal(isUnsafeAddress("::1", 6), true);
  assert.equal(isUnsafeAddress("fe80::1", 6), true);
  assert.equal(isUnsafeAddress("fc00::1", 6), true);
  assert.equal(isUnsafeAddress("fd12:3456:789a::1", 6), true);
});

test("an IPv4-mapped IPv6 address is checked against the embedded IPv4 rules", () => {
  assert.equal(isUnsafeAddress("::ffff:127.0.0.1", 6), true);
  assert.equal(isUnsafeAddress("::ffff:169.254.169.254", 6), true);
  assert.equal(isUnsafeAddress("::ffff:8.8.8.8", 6), false);
});

test("a normal public IPv6 address is safe", () => {
  assert.equal(isUnsafeAddress("2001:4860:4860::8888", 6), false);
});

test("a URL whose hostname is a literal private IP is refused before any network call", async () => {
  await assert.rejects(() => ssrfSafeFetch("http://127.0.0.1:1/whatever"), isSsrfBlocked);
  await assert.rejects(() => ssrfSafeFetch("http://169.254.169.254/latest/meta-data/"), isSsrfBlocked);
});

test("a hostname (not a literal IP) that resolves only to private/reserved addresses is refused as a clean PaymodError, not a raw undici TypeError", async () => {
  // regression: pinnedLookup once always returned the single-address form
  // even when autoSelectFamily called it with `all: true`, making net.js
  // throw `ERR_INVALID_IP_ADDRESS`. The lookup callback's error also
  // surfaces wrapped as a generic `TypeError: fetch failed` unless
  // unwrapped. Port 58399 is arbitrary but not one of WHATWG's "bad
  // ports" (1, 7, 9, ...), so this exercises pinnedLookup's own
  // rejection, not undici's port block.
  await assert.rejects(() => ssrfSafeFetch("http://localhost:58399/whatever"), isSsrfBlocked);
});

test("a non-HTTP(S) scheme is refused", async () => {
  await assert.rejects(() => ssrfSafeFetch("file:///etc/passwd"), isSsrfBlocked);
});

test("authorization, cookie and payment-signature are stripped on a cross-origin hop", () => {
  // regression: PAYMENT-SIGNATURE (the already-signed x402 transaction XDR,
  // see payment-payload.ts) wasn't on this list, so a merchant redirecting
  // a paid request to a different origin would receive a valid signed
  // transaction, not just a stale credential.
  const headers = new Headers({
    Authorization: "Bearer secret",
    Cookie: "session=secret",
    "PAYMENT-SIGNATURE": "base64-signed-transaction",
    "X-Request-Id": "keep-me",
  });

  const stripped = stripSensitiveHeaders(headers);

  assert.equal(stripped.has("authorization"), false);
  assert.equal(stripped.has("cookie"), false);
  assert.equal(stripped.has("payment-signature"), false);
  assert.equal(stripped.get("x-request-id"), "keep-me", "unrelated headers must survive a cross-origin hop");
});
