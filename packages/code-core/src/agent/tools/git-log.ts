import { getPermissionTier } from "../permissions.js";
import { ok, type Tool } from "./types.js";

const DEFAULT_LOG_COUNT = 20;

export const gitLogTool: Tool = {
  schema: {
    name: "git_log",
    description: "Show recent commit history.",
    parameters: { type: "object", properties: { count: { type: "number" } } },
  },
  tier: getPermissionTier("git_log"),
  async execute(host, args) {
    const count = typeof args["count"] === "number" ? args["count"] : DEFAULT_LOG_COUNT;
    const result = await host.runCommand({
      executable: "git",
      args: ["log", `-${count}`, "--oneline"],
      cwd: host.workspaceRoot,
    });
    return ok(result.stdout);
  },
};
