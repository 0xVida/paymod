import { getPermissionTier } from "../permissions.js";
import { ok, type Tool } from "./types.js";

export const gitStatusTool: Tool = {
  schema: { name: "git_status", description: "Show the working tree status.", parameters: { type: "object", properties: {} } },
  tier: getPermissionTier("git_status"),
  async execute(host) {
    const result = await host.runCommand({ executable: "git", args: ["status", "--short", "--branch"], cwd: host.workspaceRoot });
    return ok(result.stdout);
  },
};
