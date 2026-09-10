import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, resolve, sep } from "node:path";

export class WorkspaceEscapeError extends Error {
  constructor(requestedPath: string) {
    super(`Path escapes the workspace: ${requestedPath}`);
    this.name = "WorkspaceEscapeError";
  }
}

/**
 * resolves symlinks in whatever part of `path` already exists, without
 * requiring the full path to exist - `apply_patch` writes new files, so the
 * leaf segment is often missing.
 */
async function canonicalize(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    const parent = dirname(path);
    if (parent === path) return path;
    const canonicalParent = await canonicalize(parent);
    return canonicalParent === parent ? path : canonicalParent + path.slice(parent.length);
  }
}

/**
 * resolves a model-supplied path against the workspace root and verifies it stays
 * inside it, following symlinks in the existing part of the path so a symlink can't
 * point outside the workspace. Throws `WorkspaceEscapeError` instead of returning a
 * boolean so callers can't accidentally ignore a failed check.
 */
export async function resolveWorkspacePath(workspaceRoot: string, requestedPath: string): Promise<string> {
  const resolved = isAbsolute(requestedPath) ? requestedPath : resolve(workspaceRoot, requestedPath);
  const canonicalRoot = await canonicalize(resolve(workspaceRoot));
  const canonicalTarget = await canonicalize(resolved);
  if (canonicalTarget !== canonicalRoot && !canonicalTarget.startsWith(canonicalRoot + sep)) {
    throw new WorkspaceEscapeError(requestedPath);
  }
  return canonicalTarget;
}
