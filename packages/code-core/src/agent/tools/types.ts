import type { AgentHost } from "../../host.js";
import type { ToolSchema } from "../../model/types.js";
import type { PermissionTier } from "../permissions.js";
import { resolveWorkspacePath, WorkspaceEscapeError } from "../workspace-path.js";

export type ToolResult = { ok: true; data: unknown } | { ok: false; code: string; message: string };

export type Tool = {
  schema: ToolSchema;
  tier: PermissionTier;
  /** `signal` is only meaningful to tools that hand off to a long-running process (`run_command`, `run_tests`) - everything else can ignore it. */
  execute: (host: AgentHost, args: Record<string, unknown>, signal?: AbortSignal) => Promise<ToolResult>;
};

export function ok(data: unknown): ToolResult {
  return { ok: true, data };
}

export function fail(code: string, message: string): ToolResult {
  return { ok: false, code, message };
}

/**
 * every model-supplied path/cwd must be checked here before it reaches `host.*` or
 * `runCommand`. returns a `fail()` result if the path escapes the workspace, `undefined`
 * if safe - callers still pass the original unresolved path through, this only gates
 * whether that call happens.
 */
export async function checkWorkspacePath(host: AgentHost, requestedPath: string): Promise<ToolResult | undefined> {
  try {
    await resolveWorkspacePath(host.workspaceRoot, requestedPath);
    return undefined;
  } catch (error) {
    if (error instanceof WorkspaceEscapeError) return fail("WORKSPACE_ESCAPE", error.message);
    throw error;
  }
}
