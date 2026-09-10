import type { AgentHost } from "../../host.js";
import { getPermissionTier } from "../permissions.js";
import { resolveWorkspacePath, WorkspaceEscapeError } from "../workspace-path.js";
import { checkWorkspacePath, fail, ok, type Tool } from "./types.js";

const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", "out"]);
const MAX_FILES_SCANNED = 2000;
const MAX_MATCHES = 200;

export type SearchMatch = { path: string; line: number; text: string };

/** A symlink can point outside the workspace at any depth, not just at the root, so every recursion step re-checks containment rather than trusting the initial root check alone. An entry that escapes is skipped, not treated as a fatal error - one out-of-bounds symlink shouldn't fail the whole search. */
async function isWithinWorkspace(host: AgentHost, path: string): Promise<boolean> {
  try {
    await resolveWorkspacePath(host.workspaceRoot, path);
    return true;
  } catch (error) {
    if (error instanceof WorkspaceEscapeError) return false;
    throw error;
  }
}

async function walk(host: AgentHost, dir: string, filesScanned: { count: number }): Promise<string[]> {
  const files: string[] = [];
  const entries = await host.listDirectory(dir).catch(() => []);
  for (const entry of entries) {
    if (filesScanned.count >= MAX_FILES_SCANNED) break;
    const entryPath = `${dir}/${entry.name}`;
    if (!(await isWithinWorkspace(host, entryPath))) continue;
    if (entry.isDirectory) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      files.push(...(await walk(host, entryPath, filesScanned)));
    } else {
      filesScanned.count += 1;
      files.push(entryPath);
    }
  }
  return files;
}

export const searchFilesTool: Tool = {
  schema: {
    name: "search_files",
    description: "Search file contents in the workspace for a pattern, returning matching file:line snippets.",
    parameters: { type: "object", properties: { pattern: { type: "string" }, path: { type: "string" } }, required: ["pattern"] },
  },
  tier: getPermissionTier("search_files"),
  async execute(host, args) {
    const pattern = args["pattern"];
    if (typeof pattern !== "string") return fail("INVALID_ARGS", "pattern must be a string");
    const root = typeof args["path"] === "string" ? (args["path"] as string) : host.workspaceRoot;
    const escape = await checkWorkspacePath(host, root);
    if (escape) return escape;

    let regex: RegExp;
    try {
      regex = new RegExp(pattern);
    } catch {
      return fail("INVALID_PATTERN", `Not a valid regular expression: ${pattern}`);
    }

    const files = await walk(host, root, { count: 0 });
    const matches: SearchMatch[] = [];
    for (const path of files) {
      if (matches.length >= MAX_MATCHES) break;
      const content = await host.readFile(path).catch(() => undefined);
      if (content === undefined) continue;
      content.split("\n").forEach((text, index) => {
        if (matches.length < MAX_MATCHES && regex.test(text)) matches.push({ path, line: index + 1, text: text.trim() });
      });
    }
    return ok(matches);
  },
};
