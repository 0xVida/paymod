import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveWorkspacePath, WorkspaceEscapeError } from "./workspace-path.js";

let workspaceRoot: string;
let outsideRoot: string;

before(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), "workspace-path-inside-"));
  outsideRoot = await mkdtemp(join(tmpdir(), "workspace-path-outside-"));
  await mkdir(join(workspaceRoot, "src"), { recursive: true });
  await writeFile(join(workspaceRoot, "src", "file.ts"), "inside\n");
  await writeFile(join(outsideRoot, "secret.txt"), "outside\n");
});

after(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
  await rm(outsideRoot, { recursive: true, force: true });
});

describe("resolveWorkspacePath", () => {
  test("allows a relative path inside the workspace", async () => {
    const resolved = await resolveWorkspacePath(workspaceRoot, "src/file.ts");
    assert.ok(resolved.endsWith(join("src", "file.ts")));
  });

  test("allows a relative path that normalizes back inside the workspace", async () => {
    const resolved = await resolveWorkspacePath(workspaceRoot, "src/../src/file.ts");
    assert.ok(resolved.endsWith(join("src", "file.ts")));
  });

  test("allows a not-yet-existing path inside the workspace", async () => {
    const resolved = await resolveWorkspacePath(workspaceRoot, "src/new-file.ts");
    assert.ok(resolved.endsWith(join("src", "new-file.ts")));
  });

  test("denies a relative path that escapes the workspace", async () => {
    await assert.rejects(() => resolveWorkspacePath(workspaceRoot, "../secret.txt"), WorkspaceEscapeError);
  });

  test("denies an absolute path outside the workspace", async () => {
    await assert.rejects(() => resolveWorkspacePath(workspaceRoot, join(outsideRoot, "secret.txt")), WorkspaceEscapeError);
  });

  test("denies a sibling directory that shares a prefix with the workspace root", async () => {
    await assert.rejects(() => resolveWorkspacePath(workspaceRoot, `${workspaceRoot}-evil/file.ts`), WorkspaceEscapeError);
  });

  test("denies a symlink inside the workspace pointing outside it", async () => {
    await symlink(join(outsideRoot, "secret.txt"), join(workspaceRoot, "escape-link.txt"));
    await assert.rejects(() => resolveWorkspacePath(workspaceRoot, "escape-link.txt"), WorkspaceEscapeError);
  });

  test("allows a symlink inside the workspace pointing to another spot inside it", async () => {
    await symlink(join(workspaceRoot, "src", "file.ts"), join(workspaceRoot, "inside-link.txt"));
    const resolved = await resolveWorkspacePath(workspaceRoot, "inside-link.txt");
    assert.ok(resolved.startsWith(await resolveWorkspacePath(workspaceRoot, ".")));
  });
});
