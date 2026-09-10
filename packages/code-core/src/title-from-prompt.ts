export const DEFAULT_SESSION_TITLE = "New session";

const MAX_TITLE_LENGTH = 60;

/**
 * names a session from its first message, the way Claude Code and Cursor title a new
 * conversation, so it never sits in the list as "New session" once used. collapsed to
 * one line and capped in length since a prompt can run to paragraphs.
 */
export function titleFromPrompt(prompt: string): string {
  const collapsed = prompt.trim().replace(/\s+/g, " ");
  if (!collapsed) return DEFAULT_SESSION_TITLE;
  if (collapsed.length <= MAX_TITLE_LENGTH) return collapsed;
  return `${collapsed.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`;
}
