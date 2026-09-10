export type PermissionTier = "auto" | "configurable" | "approval";

/**
 * per-tool, not a single global "agent can use tools" toggle (per the ADR). `apply_patch`
 * is `auto` deliberately - it always routes through `AgentHost.reviewDiff()` before
 * writing, so diff review is the approval gate for edits, not this mechanism. unknown
 * tools fail closed to `approval` rather than defaulting to `auto`.
 */
const TOOL_PERMISSION_TIERS: Record<string, PermissionTier> = {
  read_file: "auto",
  search_files: "auto",
  list_directory: "auto",
  git_status: "auto",
  git_diff: "auto",
  git_log: "auto",
  apply_patch: "auto",
  get_artifact: "auto",
  run_tests: "configurable",
  run_command: "approval",
};

export function getPermissionTier(toolName: string): PermissionTier {
  return TOOL_PERMISSION_TIERS[toolName] ?? "approval";
}
