/**
 * `Session`/`StoredSession` are the real chat-facing shapes, defined once
 * in `@paymod/code-core` (shared with the future CLI host) and re-exported
 * here rather than duplicated.
 */

/** `ChatPanel` renames a session away from this the moment its first message is sent - a session still carrying it hasn't been used yet. Owned by `@paymod/code-core`'s `title-from-prompt.ts` now (shared with the CLI), re-exported here so every existing import site keeps working unchanged. */
export { DEFAULT_SESSION_TITLE } from "@paymod/code-core";

export type { Session, StoredSession } from "@paymod/code-core";
