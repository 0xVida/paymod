import { getPermissionTier } from "../permissions.js";
import { checkWorkspacePath, fail, ok, type Tool } from "./types.js";

function toArgs(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return undefined;
  return value;
}

/**
 * structured `{ executable, args }` rather than an opaque shell string
 * wherever the caller can express it, so the exact command can be shown to
 * the user, classified and escaped safely instead of trusted as a blob.
 */
export const runCommandTool: Tool = {
  schema: {
    name: "run_command",
    description: "Run a command in the workspace. Requires user approval.",
    parameters: {
      type: "object",
      properties: { executable: { type: "string" }, args: { type: "array", items: { type: "string" } }, cwd: { type: "string" } },
      required: ["executable"],
    },
  },
  tier: getPermissionTier("run_command"),
  async execute(host, args, signal) {
    const executable = args["executable"];
    if (typeof executable !== "string") return fail("INVALID_ARGS", "executable must be a string");
    const commandArgs = toArgs(args["args"]) ?? [];
    const cwd = typeof args["cwd"] === "string" ? (args["cwd"] as string) : undefined;
    if (cwd) {
      const escape = await checkWorkspacePath(host, cwd);
      if (escape) return escape;
    }

    const result = await host.runCommand({ executable, args: commandArgs, ...(cwd && { cwd }) }, signal);
    if (signal?.aborted) return fail("CANCELLED", "The user stopped the agent.");
    if (result.exitCode !== 0) return fail("COMMAND_FAILED", `Exit code ${result.exitCode}\n${result.stderr || result.stdout}`.trim());
    return ok(result);
  },
};
