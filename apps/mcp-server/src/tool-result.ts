import { isPaymodError } from "@paymod/shared";

export type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

/** a tool's successful return value, always as a single
 *
 *
 *  JSON text block */
export function toToolResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}



/**
 * a caught failure, as a structured `{code, message}`
 * block rather than a raw
 * stack trace - the model needs the policy reason,
 * not a Node.js error dump.
 */
export function toErrorToolResult(error: unknown): ToolResult {
  const body = isPaymodError(error)
    ? { code: error.code, message: error.message }
    : { code: "INTERNAL_ERROR", message: error instanceof Error ? error.message : String(error) };
  return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }], isError: true };
}

