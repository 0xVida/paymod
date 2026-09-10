import type { Tool } from "./types.js";
import { readFileTool } from "./read-file.js";
import { listDirectoryTool } from "./list-directory.js";
import { searchFilesTool } from "./search-files.js";
import { applyPatchTool } from "./apply-patch.js";
import { runCommandTool } from "./run-command.js";
import { runTestsTool } from "./run-tests.js";
import { gitStatusTool } from "./git-status.js";
import { gitDiffTool } from "./git-diff.js";
import { gitLogTool } from "./git-log.js";
import { getArtifactTool } from "./get-artifact.js";

export const ALL_TOOLS: Tool[] = [
  readFileTool,
  listDirectoryTool,
  searchFilesTool,
  applyPatchTool,
  runCommandTool,
  runTestsTool,
  gitStatusTool,
  gitDiffTool,
  gitLogTool,
  getArtifactTool,
];

export function getTool(name: string): Tool | undefined {
  return ALL_TOOLS.find((tool) => tool.schema.name === name);
}

/** tools whose approval requirement the user can turn off (see agent/permissions.ts's `PermissionTier`) - "auto" tools never prompt at all, "approval" tools (run_command) always do by design and aren't offered here. */
export function getConfigurableTools(): { name: string; description: string }[] {
  return ALL_TOOLS.filter((tool) => tool.tier === "configurable").map((tool) => ({ name: tool.schema.name, description: tool.schema.description }));
}

export * from "./types.js";
export { proposeEdits, applyEdits } from "./apply-patch.js";
