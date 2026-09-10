import { getPermissionTier } from "../permissions.js";
import { fail, ok, type Tool } from "./types.js";

/** large enough that a paginated retrieval genuinely makes progress, small enough to stay well under any model's context window on its own. */
const RETRIEVAL_CHUNK_CHARS = 20_000;

/**
 * the other half of `capping.ts`'s "forget bytes without losing the ability
 * to retrieve them" principle - full tool output is never actually deleted,
 * only capped out of the model's immediate context. `offset` paginates
 * through an artifact larger than one retrieval chunk.
 */
export const getArtifactTool: Tool = {
  schema: {
    name: "get_artifact",
    description: "Retrieve the full, uncapped output of an earlier tool call that was truncated in this conversation. Use the artifact id named in the truncation note.",
    parameters: {
      type: "object",
      properties: { artifactId: { type: "string" }, offset: { type: "number" } },
      required: ["artifactId"],
    },
  },
  tier: getPermissionTier("get_artifact"),
  async execute(host, args) {
    const artifactId = args["artifactId"];
    if (typeof artifactId !== "string") return fail("INVALID_ARGS", "artifactId must be a string");
    const offset = typeof args["offset"] === "number" ? args["offset"] : 0;

    const artifact = await host.readArtifact(artifactId);
    if (!artifact) return fail("ARTIFACT_NOT_FOUND", `No stored artifact for id ${artifactId}`);

    const chunk = artifact.fullContent.slice(offset, offset + RETRIEVAL_CHUNK_CHARS);
    const nextOffset = offset + chunk.length;
    const hasMore = nextOffset < artifact.fullContent.length;
    return ok({ content: chunk, ...(hasMore && { nextOffset }) });
  },
};
