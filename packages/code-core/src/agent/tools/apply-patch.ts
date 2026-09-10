import type { AgentHost, ProposedEdit } from "../../host.js";
import { getPermissionTier } from "../permissions.js";
import { resolveWorkspacePath } from "../workspace-path.js";
import { fail, ok, type Tool } from "./types.js";

type EditInput = { path: string; content: string };

/** read-only - computes the diff without writing anything. new files (no existing content) diff against an empty original. */
export async function proposeEdits(host: AgentHost, edits: EditInput[]): Promise<ProposedEdit[]> {
  const proposed: ProposedEdit[] = [];
  for (const edit of edits) {
    await resolveWorkspacePath(host.workspaceRoot, edit.path);
    const originalContent = await host.readFile(edit.path).catch(() => "");
    proposed.push({ path: edit.path, originalContent, newContent: edit.content });
  }
  return proposed;
}

export async function applyEdits(host: AgentHost, edits: ProposedEdit[]): Promise<void> {
  for (const edit of edits) {
    await resolveWorkspacePath(host.workspaceRoot, edit.path);
    await host.writeFile(edit.path, edit.newContent);
  }
}

function isEditInput(value: unknown): value is EditInput {
  return typeof value === "object" && value !== null && typeof (value as EditInput).path === "string" && typeof (value as EditInput).content === "string";
}

/**
 * the only model-facing way a file changes (see the build plan's "no
 * write_file tool" invariant). always routes through `AgentHost.reviewDiff`
 * before writing - the diff review is the approval gate, not a separate
 * permission-tier prompt.
 */
export const applyPatchTool: Tool = {
  schema: {
    name: "apply_patch",
    description: "Propose one or more file edits as full new file contents. Shows a diff for review before anything is written.",
    parameters: {
      type: "object",
      properties: { edits: { type: "array", items: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } } } } },
      required: ["edits"],
    },
  },
  tier: getPermissionTier("apply_patch"),
  async execute(host, args) {
    const rawEdits = args["edits"];
    if (!Array.isArray(rawEdits) || !rawEdits.every(isEditInput)) {
      return fail("INVALID_ARGS", "edits must be an array of { path, content }");
    }

    let proposed: ProposedEdit[];
    try {
      proposed = await proposeEdits(host, rawEdits);
    } catch (error) {
      return fail("WORKSPACE_ESCAPE", error instanceof Error ? error.message : "Path escapes the workspace");
    }
    host.emit({ type: "diff_ready", edits: proposed });

    const review = await host.reviewDiff(proposed);
    if (review.decision === "reject") {
      return fail("EDIT_REJECTED", `The user rejected these changes${review.reason ? `: ${review.reason}` : "."}`);
    }

    await applyEdits(host, proposed);
    return ok({ appliedPaths: proposed.map((edit) => edit.path) });
  },
};
