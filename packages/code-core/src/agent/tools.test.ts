import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RealHost } from "../testing/real-host.js";
import { FakeHost } from "../testing/fake-host.js";
import { readFileTool } from "./tools/read-file.js";
import { listDirectoryTool } from "./tools/list-directory.js";
import { searchFilesTool } from "./tools/search-files.js";
import { applyPatchTool } from "./tools/apply-patch.js";
import { runCommandTool } from "./tools/run-command.js";
import { runTestsTool } from "./tools/run-tests.js";
import { gitStatusTool } from "./tools/git-status.js";
import { gitDiffTool } from "./tools/git-diff.js";
import { gitLogTool } from "./tools/git-log.js";
import { getArtifactTool } from "./tools/get-artifact.js";
import { capToolResult, HEAD_LINES, MAX_DIFF_LINES, MAX_DIRECTORY_ENTRIES, MAX_READ_FILE_CHARS, MAX_STATUS_LINES, MAX_STDOUT_LINES, TAIL_LINES } from "./tools/capping.js";
import { fail, ok } from "./tools/types.js";

function repeatLines(count: number, prefix = "line"): string {
  return Array.from({ length: count }, (_, i) => `${prefix} ${i + 1}`).join("\n");
}

let workspaceRoot: string;
let outsideRoot: string;
let host: RealHost;

before(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), "code-core-tools-"));
  outsideRoot = await mkdtemp(join(tmpdir(), "code-core-tools-outside-"));
  host = new RealHost(workspaceRoot);
  await writeFile(join(workspaceRoot, "hello.txt"), "hello world\n");
  await writeFile(join(outsideRoot, "secret.txt"), "outside\n");
  await host.runCommand({ executable: "git", args: ["init"] });
  await host.runCommand({ executable: "git", args: ["config", "user.email", "test@paymod.dev"] });
  await host.runCommand({ executable: "git", args: ["config", "user.name", "Test"] });
  await host.runCommand({ executable: "git", args: ["add", "."] });
  await host.runCommand({ executable: "git", args: ["commit", "-m", "initial"] });
});

after(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
  await rm(outsideRoot, { recursive: true, force: true });
});

describe("read_file", () => {
  test("reads a real file", async () => {
    const result = await readFileTool.execute(host, { path: join(workspaceRoot, "hello.txt") });
    assert.deepEqual(result, { ok: true, data: "hello world\n" });
  });

  test("fails cleanly on a missing file", async () => {
    const result = await readFileTool.execute(host, { path: join(workspaceRoot, "missing.txt") });
    assert.equal(result.ok, false);
  });
});

describe("list_directory", () => {
  test("lists a real directory", async () => {
    const result = await listDirectoryTool.execute(host, { path: workspaceRoot });
    assert.ok(result.ok);
    const names = (result.data as { name: string }[]).map((entry) => entry.name);
    assert.ok(names.includes("hello.txt"));
  });
});

describe("search_files", () => {
  test("finds a match by regex across real files", async () => {
    const result = await searchFilesTool.execute(host, { pattern: "hello", path: workspaceRoot });
    assert.ok(result.ok);
    const matches = result.data as { path: string; line: number }[];
    assert.ok(matches.some((match) => match.path.endsWith("hello.txt")));
  });

  test("rejects an invalid regex", async () => {
    const result = await searchFilesTool.execute(host, { pattern: "(unclosed" });
    assert.equal(result.ok, false);
  });
});

describe("apply_patch", () => {
  test("writes real content to disk on accept", async () => {
    host.reviewDecision = { decision: "accept" };
    const path = join(workspaceRoot, "written.txt");
    const result = await applyPatchTool.execute(host, { edits: [{ path, content: "new content\n" }] });
    assert.equal(result.ok, true);
    assert.equal(await host.readFile(path), "new content\n");
  });

  test("writes nothing on reject", async () => {
    host.reviewDecision = { decision: "reject", reason: "not needed" };
    const path = join(workspaceRoot, "not-written.txt");
    const result = await applyPatchTool.execute(host, { edits: [{ path, content: "should not land" }] });
    assert.equal(result.ok, false);
    await assert.rejects(() => host.readFile(path));
    host.reviewDecision = { decision: "accept" };
  });
});

describe("run_command", () => {
  test("runs a real process and reports a nonzero exit code as a failure", async () => {
    const ok = await runCommandTool.execute(host, { executable: "node", args: ["-e", "process.exit(0)"] });
    assert.equal(ok.ok, true);

    const failing = await runCommandTool.execute(host, { executable: "node", args: ["-e", "process.exit(3)"] });
    assert.equal(failing.ok, false);
  });
});

describe("run_tests", () => {
  test("respects an explicit command override without detecting a package manager", async () => {
    const result = await runTestsTool.execute(host, { command: "node", args: ["-e", "process.exit(0)"] });
    assert.equal(result.ok, true);
  });
});

describe("git tools", () => {
  test("git_status reports a clean tree after the initial commit", async () => {
    const result = await gitStatusTool.execute(host, {});
    assert.ok(result.ok);
  });

  test("git_log shows the initial commit", async () => {
    const result = await gitLogTool.execute(host, {});
    assert.ok(result.ok);
    assert.match(result.data as string, /initial/);
  });

  test("git_diff shows an unstaged change", async () => {
    await host.writeFile(join(workspaceRoot, "hello.txt"), "hello world, again\n");
    const result = await gitDiffTool.execute(host, {});
    assert.ok(result.ok);
    assert.match(result.data as string, /again/);
    await host.writeFile(join(workspaceRoot, "hello.txt"), "hello world\n");
  });
});

describe("workspace confinement", () => {
  test("read_file denies a relative escape", async () => {
    const result = await readFileTool.execute(host, { path: "../etc/passwd" });
    assert.equal(result.ok, false);
    assert.equal((result as { code: string }).code, "WORKSPACE_ESCAPE");
  });

  test("read_file denies an absolute path outside the workspace", async () => {
    const result = await readFileTool.execute(host, { path: join(outsideRoot, "secret.txt") });
    assert.equal(result.ok, false);
    assert.equal((result as { code: string }).code, "WORKSPACE_ESCAPE");
  });

  test("list_directory denies an escape", async () => {
    const result = await listDirectoryTool.execute(host, { path: outsideRoot });
    assert.equal(result.ok, false);
    assert.equal((result as { code: string }).code, "WORKSPACE_ESCAPE");
  });

  test("apply_patch denies writing outside the workspace", async () => {
    host.reviewDecision = { decision: "accept" };
    const result = await applyPatchTool.execute(host, {
      edits: [{ path: join(outsideRoot, "written-by-escape.txt"), content: "should never land" }],
    });
    assert.equal(result.ok, false);
    assert.equal((result as { code: string }).code, "WORKSPACE_ESCAPE");
  });

  test("run_command denies an escaping cwd", async () => {
    const result = await runCommandTool.execute(host, { executable: "node", args: ["-e", "process.exit(0)"], cwd: "../" });
    assert.equal(result.ok, false);
    assert.equal((result as { code: string }).code, "WORKSPACE_ESCAPE");
  });

  test("git_diff denies an escaping path argument", async () => {
    const result = await gitDiffTool.execute(host, { path: join(outsideRoot, "secret.txt") });
    assert.equal(result.ok, false);
    assert.equal((result as { code: string }).code, "WORKSPACE_ESCAPE");
  });

  test("search_files denies an escaping root", async () => {
    const result = await searchFilesTool.execute(host, { pattern: "outside", path: outsideRoot });
    assert.equal(result.ok, false);
    assert.equal((result as { code: string }).code, "WORKSPACE_ESCAPE");
  });

  test("search_files skips a symlinked file that escapes the workspace instead of reading through it", async () => {
    await symlink(join(outsideRoot, "secret.txt"), join(workspaceRoot, "escape-link.txt"));
    const result = await searchFilesTool.execute(host, { pattern: "outside", path: workspaceRoot });
    assert.ok(result.ok);
    const matches = result.data as { path: string }[];
    assert.ok(!matches.some((match) => match.path.endsWith("escape-link.txt")));
  });
});

describe("capToolResult: read_file", () => {
  test("passes through content under the char limit unchanged", () => {
    const result = ok("small file content");
    const { capped, wasCapped } = capToolResult("read_file", "tc_1", result);
    assert.equal(wasCapped, false);
    assert.deepEqual(capped, result);
  });

  test("caps content over the char limit and names the artifact id", () => {
    const big = "x".repeat(MAX_READ_FILE_CHARS + 500);
    const { capped, wasCapped, fullContent } = capToolResult("read_file", "tc_read", ok(big));
    assert.equal(wasCapped, true);
    assert.equal(fullContent, big);
    assert.ok(capped.ok);
    const text = capped.data as string;
    assert.ok(text.length < big.length);
    assert.match(text, /get_artifact\(artifactId: "tc_read"\)/);
  });

  test("a failed read_file passes through unchanged", () => {
    const result = fail("READ_FAILED", "no such file");
    const { capped, wasCapped } = capToolResult("read_file", "tc_1", result);
    assert.equal(wasCapped, false);
    assert.deepEqual(capped, result);
  });
});

describe("capToolResult: run_command / run_tests", () => {
  test("passes through a short successful command unchanged", () => {
    const result = ok({ stdout: "done\n", stderr: "", exitCode: 0 });
    const { wasCapped, capped } = capToolResult("run_command", "tc_1", result);
    assert.equal(wasCapped, false);
    assert.deepEqual(capped, result);
  });

  test("caps long stdout with head+tail, preserving both ends and dropping the middle", () => {
    const stdout = repeatLines(MAX_STDOUT_LINES + 50);
    const result = ok({ stdout, stderr: "", exitCode: 0 });
    const { capped, wasCapped, fullContent } = capToolResult("run_command", "tc_cmd", result);
    assert.equal(wasCapped, true);
    assert.ok(fullContent.includes("--- stdout ---"));
    assert.ok(capped.ok);
    const cappedStdout = (capped.data as { stdout: string }).stdout;
    assert.match(cappedStdout, /^line 1\n/);
    assert.match(cappedStdout, new RegExp(`line ${MAX_STDOUT_LINES + 50}$`));
    assert.match(cappedStdout, /get_artifact\(artifactId: "tc_cmd"\)/);
    // the head is exactly the first HEAD_LINES lines, unmodified
    assert.ok(cappedStdout.startsWith(repeatLines(HEAD_LINES)));
    // the tail is exactly the last TAIL_LINES lines, unmodified
    assert.ok(cappedStdout.endsWith(Array.from({ length: TAIL_LINES }, (_, i) => `line ${MAX_STDOUT_LINES + 50 - TAIL_LINES + i + 1}`).join("\n")));
  });

  test("caps a failure message the same way, since stdout/stderr are already concatenated by the tool", () => {
    const message = `Exit code 1\n${repeatLines(MAX_STDOUT_LINES + 50)}`;
    const result = fail("COMMAND_FAILED", message);
    const { capped, wasCapped, fullContent } = capToolResult("run_command", "tc_fail", result);
    assert.equal(wasCapped, true);
    assert.equal(fullContent, message);
    assert.equal(capped.ok, false);
    assert.match((capped as { message: string }).message, /get_artifact\(artifactId: "tc_fail"\)/);
  });

  test("keeps exitCode untouched by capping", () => {
    const stdout = repeatLines(MAX_STDOUT_LINES + 50);
    const { capped } = capToolResult("run_tests", "tc_1", ok({ stdout, stderr: "", exitCode: 7 }));
    assert.ok(capped.ok);
    assert.equal((capped.data as { exitCode: number }).exitCode, 7);
  });
});

describe("capToolResult: git_diff", () => {
  test("passes through a small diff unchanged", () => {
    const result = ok("diff --git a/x b/x\n+added line\n");
    const { capped, wasCapped } = capToolResult("git_diff", "tc_1", result);
    assert.equal(wasCapped, false);
    assert.deepEqual(capped, result);
  });

  test("caps a large diff and always keeps the touched-files summary", () => {
    const diff = `diff --git a/big.ts b/big.ts\n${repeatLines(MAX_DIFF_LINES + 100, "+added")}`;
    const { capped, wasCapped, fullContent } = capToolResult("git_diff", "tc_diff", ok(diff));
    assert.equal(wasCapped, true);
    assert.equal(fullContent, diff);
    assert.ok(capped.ok);
    const text = capped.data as string;
    assert.match(text, /^Touched files:\ndiff --git a\/big\.ts b\/big\.ts/);
    assert.match(text, /get_artifact\(artifactId: "tc_diff"\)/);
  });
});

describe("capToolResult: git_status", () => {
  test("caps very long status output", () => {
    const status = repeatLines(MAX_STATUS_LINES + 10, "M file");
    const { capped, wasCapped } = capToolResult("git_status", "tc_1", ok(status));
    assert.equal(wasCapped, true);
    assert.ok(capped.ok);
    assert.match(capped.data as string, /get_artifact/);
  });
});

describe("capToolResult: list_directory", () => {
  test("passes through a small listing unchanged", () => {
    const entries = [{ name: "a.ts", isDirectory: false }];
    const { capped, wasCapped } = capToolResult("list_directory", "tc_1", ok(entries));
    assert.equal(wasCapped, false);
    assert.deepEqual(capped, ok(entries));
  });

  test("caps a huge directory listing and appends a marker entry naming the artifact id", () => {
    const entries = Array.from({ length: MAX_DIRECTORY_ENTRIES + 20 }, (_, i) => ({ name: `file${i}.ts`, isDirectory: false }));
    const { capped, wasCapped, fullContent } = capToolResult("list_directory", "tc_dir", ok(entries));
    assert.equal(wasCapped, true);
    assert.equal(JSON.parse(fullContent).length, MAX_DIRECTORY_ENTRIES + 20);
    assert.ok(capped.ok);
    const capList = capped.data as { name: string; isDirectory: boolean }[];
    assert.equal(capList.length, MAX_DIRECTORY_ENTRIES + 1);
    assert.match(capList[capList.length - 1]!.name, /get_artifact\(artifactId: "tc_dir"\)/);
  });
});

describe("capToolResult: already-bounded tools pass through but still produce fullContent", () => {
  test("search_files is never capped by this module", () => {
    const matches = [{ path: "a.ts", line: 1, text: "match" }];
    const { capped, wasCapped, fullContent } = capToolResult("search_files", "tc_1", ok(matches));
    assert.equal(wasCapped, false);
    assert.deepEqual(capped, ok(matches));
    assert.equal(fullContent, JSON.stringify(matches, null, 2));
  });

  test("apply_patch is never capped by this module", () => {
    const data = { appliedPaths: ["a.ts"] };
    const { wasCapped, fullContent } = capToolResult("apply_patch", "tc_1", ok(data));
    assert.equal(wasCapped, false);
    assert.equal(fullContent, JSON.stringify(data, null, 2));
  });
});

describe("get_artifact", () => {
  test("retrieves a previously saved artifact's full content", async () => {
    const fakeHost = new FakeHost();
    await fakeHost.saveArtifact({ toolCallId: "tc_1", toolName: "read_file", createdAt: "2026-09-07T00:00:00.000Z", ok: true, fullContent: "the full content" });

    const result = await getArtifactTool.execute(fakeHost, { artifactId: "tc_1" });
    assert.ok(result.ok);
    assert.equal((result.data as { content: string }).content, "the full content");
  });

  test("fails cleanly for an unknown artifact id", async () => {
    const fakeHost = new FakeHost();
    const result = await getArtifactTool.execute(fakeHost, { artifactId: "missing" });
    assert.equal(result.ok, false);
    assert.equal((result as { code: string }).code, "ARTIFACT_NOT_FOUND");
  });

  test("rejects a non-string artifactId", async () => {
    const fakeHost = new FakeHost();
    const result = await getArtifactTool.execute(fakeHost, { artifactId: 123 });
    assert.equal(result.ok, false);
    assert.equal((result as { code: string }).code, "INVALID_ARGS");
  });

  test("paginates a large artifact via offset/nextOffset", async () => {
    const fakeHost = new FakeHost();
    const big = "x".repeat(45_000);
    await fakeHost.saveArtifact({ toolCallId: "tc_big", toolName: "read_file", createdAt: "2026-09-07T00:00:00.000Z", ok: true, fullContent: big });

    const first = await getArtifactTool.execute(fakeHost, { artifactId: "tc_big" });
    assert.ok(first.ok);
    const firstData = first.data as { content: string; nextOffset?: number };
    assert.equal(firstData.content.length, 20_000);
    assert.equal(firstData.nextOffset, 20_000);

    const second = await getArtifactTool.execute(fakeHost, { artifactId: "tc_big", offset: firstData.nextOffset });
    assert.ok(second.ok);
    const secondData = second.data as { content: string; nextOffset?: number };
    assert.equal(secondData.content.length, 20_000);
    assert.equal(secondData.nextOffset, 40_000);

    const third = await getArtifactTool.execute(fakeHost, { artifactId: "tc_big", offset: secondData.nextOffset });
    assert.ok(third.ok);
    const thirdData = third.data as { content: string; nextOffset?: number };
    assert.equal(thirdData.content.length, 5_000);
    assert.equal(thirdData.nextOffset, undefined);
  });
});
