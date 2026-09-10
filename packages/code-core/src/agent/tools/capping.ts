import { fail, ok, type ToolResult } from "./types.js";

export const MAX_READ_FILE_CHARS = 8_000;
export const MAX_STDOUT_LINES = 200;
export const HEAD_LINES = 100;
export const TAIL_LINES = 100;
export const MAX_STDERR_CHARS = 4_000;
export const MAX_DIFF_LINES = 1_500;
export const MAX_STATUS_LINES = 300;
export const MAX_DIRECTORY_ENTRIES = 500;

export type CappedResult = { capped: ToolResult; wasCapped: boolean; fullContent: string };

/**
 * fixed-size truncation alone causes the model to reread files or lose critical output,
 * so every cap ends with a note naming the artifact id (the tool call's own id) so
 * `get_artifact` can retrieve the rest.
 */
function truncationNote(kind: string, omitted: number, toolCallId: string): string {
  return `\n[truncated: ${omitted} more ${kind}. Retrieve the full content with get_artifact(artifactId: "${toolCallId}").]`;
}

function capChars(text: string, maxChars: number, toolCallId: string): { text: string; wasCapped: boolean } {
  if (text.length <= maxChars) return { text, wasCapped: false };
  return { text: `${text.slice(0, maxChars)}${truncationNote("characters", text.length - maxChars, toolCallId)}`, wasCapped: true };
}

function capLinesHead(text: string, maxLines: number, toolCallId: string): { text: string; wasCapped: boolean } {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return { text, wasCapped: false };
  return { text: `${lines.slice(0, maxLines).join("\n")}${truncationNote("lines", lines.length - maxLines, toolCallId)}`, wasCapped: true };
}

/** keeps both ends of a long output and drops only the middle - a build's setup output and its final failure are usually at opposite ends. */
function capLinesHeadTail(text: string, maxLines: number, headLines: number, tailLines: number, toolCallId: string): { text: string; wasCapped: boolean } {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return { text, wasCapped: false };
  const head = lines.slice(0, headLines);
  const tail = lines.slice(-tailLines);
  const note = truncationNote("lines", lines.length - headLines - tailLines, toolCallId);
  return { text: `${head.join("\n")}${note}\n\n${tail.join("\n")}`, wasCapped: true };
}

function extractTouchedFiles(diffText: string): string {
  const files = diffText.split("\n").filter((line) => line.startsWith("diff --git "));
  if (files.length === 0) return "";
  return `Touched files:\n${files.join("\n")}\n\n`;
}

function fullContentOf(result: ToolResult): string {
  if (!result.ok) return result.message;
  return typeof result.data === "string" ? result.data : JSON.stringify(result.data, null, 2);
}

function passThrough(result: ToolResult): CappedResult {
  return { capped: result, wasCapped: false, fullContent: fullContentOf(result) };
}

function capReadFile(toolCallId: string, result: ToolResult): CappedResult {
  if (!result.ok || typeof result.data !== "string") return passThrough(result);
  const fullContent = result.data;
  const { text, wasCapped } = capChars(fullContent, MAX_READ_FILE_CHARS, toolCallId);
  return { capped: ok(text), wasCapped, fullContent };
}

function capGitDiff(toolCallId: string, result: ToolResult): CappedResult {
  if (!result.ok || typeof result.data !== "string") return passThrough(result);
  const fullContent = result.data;
  const { text, wasCapped } = capLinesHead(fullContent, MAX_DIFF_LINES, toolCallId);
  if (!wasCapped) return { capped: result, wasCapped, fullContent };
  return { capped: ok(`${extractTouchedFiles(fullContent)}${text}`), wasCapped, fullContent };
}

function capPlainString(toolCallId: string, result: ToolResult, maxLines: number): CappedResult {
  if (!result.ok || typeof result.data !== "string") return passThrough(result);
  const fullContent = result.data;
  const { text, wasCapped } = capLinesHead(fullContent, maxLines, toolCallId);
  return { capped: wasCapped ? ok(text) : result, wasCapped, fullContent };
}

function capDirectoryListing(toolCallId: string, result: ToolResult): CappedResult {
  if (!result.ok || !Array.isArray(result.data)) return passThrough(result);
  const entries = result.data as { name: string; isDirectory: boolean }[];
  const fullContent = JSON.stringify(entries, null, 2);
  if (entries.length <= MAX_DIRECTORY_ENTRIES) return { capped: result, wasCapped: false, fullContent };
  const omitted = entries.length - MAX_DIRECTORY_ENTRIES;
  const marker = { name: truncationNote("entries", omitted, toolCallId).trim(), isDirectory: false };
  return { capped: ok([...entries.slice(0, MAX_DIRECTORY_ENTRIES), marker]), wasCapped: true, fullContent };
}

type CommandResultLike = { stdout: string; stderr: string; exitCode: number };

function isCommandResult(value: unknown): value is CommandResultLike {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as CommandResultLike).stdout === "string" &&
    typeof (value as CommandResultLike).stderr === "string" &&
    typeof (value as CommandResultLike).exitCode === "number"
  );
}

/**
 * handles both shapes `run_command`/`run_tests` return: `ok(CommandResult)` on success
 * (stdout/stderr capped independently), or `fail(code, message)` on a nonzero exit where
 * stdout+stderr are already concatenated into one string, so it's capped as one blob.
 */
function capCommand(toolCallId: string, result: ToolResult): CappedResult {
  if (result.ok) {
    if (!isCommandResult(result.data)) return passThrough(result);
    const { stdout, stderr, exitCode } = result.data;
    const fullContent = `Exit code: ${exitCode}\n\n--- stdout ---\n${stdout}\n\n--- stderr ---\n${stderr}`;
    const cappedStdout = capLinesHeadTail(stdout, MAX_STDOUT_LINES, HEAD_LINES, TAIL_LINES, toolCallId);
    const cappedStderr = capChars(stderr, MAX_STDERR_CHARS, toolCallId);
    return {
      capped: ok({ stdout: cappedStdout.text, stderr: cappedStderr.text, exitCode }),
      wasCapped: cappedStdout.wasCapped || cappedStderr.wasCapped,
      fullContent,
    };
  }
  const { text, wasCapped } = capLinesHeadTail(result.message, MAX_STDOUT_LINES, HEAD_LINES, TAIL_LINES, toolCallId);
  return { capped: wasCapped ? fail(result.code, text) : result, wasCapped, fullContent: result.message };
}

/**
 * Classified per tool rather than truncated arbitrarily, per the context compaction
 * plan's "context can forget bytes without losing the ability to retrieve them"
 * principle. `search_files`/`git_log`/`apply_patch` are already bounded by their own
 * tool-level caps and pass through unchanged.
 */
export function capToolResult(toolName: string, toolCallId: string, result: ToolResult): CappedResult {
  switch (toolName) {
    case "read_file":
      return capReadFile(toolCallId, result);
    case "run_command":
    case "run_tests":
      return capCommand(toolCallId, result);
    case "git_diff":
      return capGitDiff(toolCallId, result);
    case "git_status":
      return capPlainString(toolCallId, result, MAX_STATUS_LINES);
    case "list_directory":
      return capDirectoryListing(toolCallId, result);
    default:
      return passThrough(result);
  }
}
