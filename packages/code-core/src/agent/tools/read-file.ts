import { getPermissionTier } from "../permissions.js";
import { checkWorkspacePath, fail, ok, type Tool } from "./types.js";

export const readFileTool: Tool = {
  schema: {
    name: "read_file",
    description: "Read the full contents of a file in the workspace.",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
  tier: getPermissionTier("read_file"),
  async execute(host, args) {
    const path = args["path"];
    if (typeof path !== "string") return fail("INVALID_ARGS", "path must be a string");
    const escape = await checkWorkspacePath(host, path);
    if (escape) return escape;
    try {
      return ok(await host.readFile(path));
    } catch (error) {
      return fail("READ_FAILED", error instanceof Error ? error.message : "Could not read file");
    }
  },
};
