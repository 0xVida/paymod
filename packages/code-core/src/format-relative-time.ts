/**
 * "2 min ago" instead of a raw `lastActivity` ISO timestamp. Rendered once, server-side,
 * at the same points the session list already re-renders (`SessionRegistry.onDidChange`),
 * not on a client-side timer - staleness only shows if a webview sits open with zero
 * activity for several minutes, an acceptable tradeoff against a second timer-driven runtime.
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const diffMs = now.getTime() - then.getTime();
  if (Number.isNaN(diffMs)) return iso;

  const diffSeconds = Math.round(diffMs / 1000);
  if (diffSeconds < 5) return "just now";
  if (diffSeconds < 60) return `${diffSeconds} sec ago`;

  const diffMinutes = Math.round(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes} min ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hr ago`;

  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;

  const diffWeeks = Math.round(diffDays / 7);
  if (diffDays < 30) return `${diffWeeks} week${diffWeeks === 1 ? "" : "s"} ago`;

  // anything older than about a month reads better as an actual date than
  // as an ever-growing "N months ago"
  return then.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
