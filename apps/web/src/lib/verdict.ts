import type { Verdict } from "./data";

/**
 * ported from `verdictColor(v)` in the mockups' x-dc script. the mockup
 * returned literal oklch strings - this returns the matching token so the
 * colour follows the active theme.
 */
export function verdictColor(v: Verdict | string): string {
  if (v === "ALLOW" || v === "ALLOWED" || v === "APPROVED" || v === "SIGNED") return "var(--sage)";
  if (v === "REVIEW" || v === "HELD" || v === "REQUIRE_APPROVAL") return "var(--rust)";
  return "var(--ink-muted)";
}
