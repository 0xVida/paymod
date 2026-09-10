import type { AgentHost } from "../../host.js";
import { getPermissionTier } from "../permissions.js";
import { fail, ok, type Tool } from "./types.js";

async function detectTestCommand(host: AgentHost): Promise<{ executable: string; args: string[] }> {
  const entries = await host.listDirectory(host.workspaceRoot).catch(() => []);
  const names = new Set(entries.map((entry) => entry.name));
  if (names.has("pnpm-lock.yaml")) return { executable: "pnpm", args: ["test"] };
  if (names.has("yarn.lock")) return { executable: "yarn", args: ["test"] };
  return { executable: "npm", args: ["test"] };
}

/** wraps run_command with a package-manager-aware default test command. Lower tier than run_command: running the existing test suite is far less risky than an arbitrary command. */
export const runTestsTool: Tool = {
  schema: {
    name: "run_tests",
    description: "Run the workspace's test suite. Detects npm/yarn/pnpm automatically unless a command is given.",
    parameters: { type: "object", properties: { command: { type: "string" }, args: { type: "array", items: { type: "string" } } } },
  },
  tier: getPermissionTier("run_tests"),
  async execute(host, args, signal) {
    const command =
      typeof args["command"] === "string"
        ? { executable: args["command"] as string, args: Array.isArray(args["args"]) ? (args["args"] as string[]) : [] }
        : await detectTestCommand(host);

    const result = await host.runCommand(command, signal);
    if (signal?.aborted) return fail("CANCELLED", "The user stopped the agent.");
    if (result.exitCode !== 0) return fail("TESTS_FAILED", `Exit code ${result.exitCode}\n${result.stdout}\n${result.stderr}`.trim());
    return ok(result);
  },
};
