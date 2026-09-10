import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { commandLineFor, describeToolCall } from "./tool-display.js";

describe("commandLineFor", () => {
  test("run_command joins executable and args", () => {
    assert.equal(commandLineFor("run_command", { executable: "node", args: ["-e", "1"] }), "node -e 1");
  });

  test("run_tests uses the explicit command when given", () => {
    assert.equal(commandLineFor("run_tests", { command: "pnpm", args: ["test"] }), "pnpm test");
  });

  test("run_tests falls back to a sensible default when no command is given", () => {
    assert.equal(commandLineFor("run_tests", {}), "npm test");
  });

  test("returns undefined for tools that don't run a shell command", () => {
    assert.equal(commandLineFor("read_file", { path: "a.txt" }), undefined);
  });
});

describe("describeToolCall", () => {
  test("read_file names the path", () => {
    assert.equal(describeToolCall("read_file", { path: "src/a.ts" }), "Reading src/a.ts");
  });

  test("apply_patch, search_files, list_directory and run_tests use fixed labels", () => {
    assert.equal(describeToolCall("apply_patch", {}), "Editing files");
    assert.equal(describeToolCall("search_files", {}), "Searching the codebase");
    assert.equal(describeToolCall("list_directory", {}), "Listing files");
    assert.equal(describeToolCall("run_tests", {}), "Running tests");
  });

  test("run_command names the executable", () => {
    assert.equal(describeToolCall("run_command", { executable: "npm" }), "Running npm");
  });

  test("git_* tools are described by their suffix", () => {
    assert.equal(describeToolCall("git_diff", {}), "Checking diff");
  });

  test("an unrecognized tool falls back to its raw name", () => {
    assert.equal(describeToolCall("mystery_tool", {}), "mystery_tool");
  });
});
