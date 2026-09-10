import { getPermissionTier } from "../permissions.js";
import { checkWorkspacePath, ok, type Tool } from "./types.js";

export const gitDiffTool: Tool = {
  schema: {
    name: "git_diff",
    description: "Show unstaged changes or changes for a specific path.",
    parameters: { type: "object", properties: { path: { type: "string" } } },
  },
  tier: getPermissionTier("git_diff"),
  async execute(host, args) {
    const path = typeof args["path"] === "string" ? (args["path"] as string) : undefined;
    if (path) {
      const escape = await checkWorkspacePath(host, path);
      if (escape) return escape;
    }
    const result = await host.runCommand({ executable: "git", args: ["diff", ...(path ? [path] : [])], cwd: host.workspaceRoot });
    return ok(result.stdout);
  },
};
