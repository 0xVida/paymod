import { getPermissionTier } from "../permissions.js";
import { checkWorkspacePath, fail, ok, type Tool } from "./types.js";

export const listDirectoryTool: Tool = {
  schema: {
    name: "list_directory",
    description: "List the files and subdirectories at a path in the workspace.",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
  tier: getPermissionTier("list_directory"),
  async execute(host, args) {
    const path = args["path"];
    if (typeof path !== "string") return fail("INVALID_ARGS", "path must be a string");
    const escape = await checkWorkspacePath(host, path);
    if (escape) return escape;
    try {
      return ok(await host.listDirectory(path));
    } catch (error) {
      return fail("LIST_FAILED", error instanceof Error ? error.message : "Could not list directory");
    }
  },
};
