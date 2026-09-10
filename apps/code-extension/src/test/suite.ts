import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as vscode from "vscode";
import {
  runAgentLoop,
  type DiffReviewResult,
  type ModelEvent,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
} from "@paymod/code-core";
import { VSCodeHost } from "../agent/vscode-host.js";
import { DiffContentProvider, diffUrisFor } from "../agent/diff-content-provider.js";
import type { CredentialStore } from "../auth/credential-store.js";

/**
 * the one deliberate exception to this repo's plain `node:test` convention:
 * these run inside a real VS Code extension host (`@vscode/test-electron`)
 * to prove what a fake host can't - real activation, real `vscode.diff`
 * editors and edits that really land on disk. Model calls are still faked;
 * the point is the host and the editor, not the model.
 */

const EXTENSION_ID = "paymod.paymod-code";

type TestCase = { name: string; fn: () => Promise<void> };
const cases: TestCase[] = [];
function test(name: string, fn: () => Promise<void>): void {
  cases.push({ name, fn });
}

function fakeProvider(responses: ModelResponse[]): ModelProvider {
  let call = 0;
  return {
    id: "fake",
    generate: () => Promise.reject(new Error("not used in these tests")),
    async *stream(_request: ModelRequest): AsyncIterable<ModelEvent> {
      const response = responses[Math.min(call++, responses.length - 1)]!;
      yield { type: "message_stop", response };
    },
    estimateTokens: () => Promise.reject(new Error("not used in these tests")),
  };
}

const noCredentials = {
  get: () => Promise.resolve(undefined),
  set: () => Promise.resolve(),
  clear: () => Promise.resolve(),
} as unknown as CredentialStore;

async function makeWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), "paymod-code-e2e-ws-"));
}

/**
 * `reviewDiff` answers inline in the chat webview in production
 * (`ChatPanel.requestDiffDecision`); here there is no webview, so the
 * decision is just the fixed value the test asks for, returned immediately.
 */
function makeHost(
  workspaceRoot: string,
  sessionsDir = workspaceRoot,
  diffDecision: DiffReviewResult = { decision: "accept" },
  artifactsDir = workspaceRoot,
  compactionRecordsDir = workspaceRoot,
): { host: VSCodeHost; events: unknown[] } {
  const events: unknown[] = [];
  const host = new VSCodeHost(
    workspaceRoot,
    "test-session",
    noCredentials,
    new DiffContentProvider(),
    sessionsDir,
    artifactsDir,
    compactionRecordsDir,
    (event) => events.push(event),
    () => Promise.resolve(diffDecision),
    () => [],
  );
  return { host, events };
}

/**
 * `requestApproval` still blocks on a real modal, which never resolves in a
 * headless run. Swapping `showWarningMessage` for the duration of one call
 * is what makes the allow/deny paths testable at all; it is restored even
 * if the body throws.
 */
async function withModalAnswers<T>(answers: { warning?: string | undefined }, body: () => Promise<T>): Promise<T> {
  const realWarning = vscode.window.showWarningMessage;
  (vscode.window as { showWarningMessage: unknown }).showWarningMessage = () => Promise.resolve(answers.warning);
  try {
    return await body();
  } finally {
    (vscode.window as { showWarningMessage: unknown }).showWarningMessage = realWarning;
  }
}

function diffTabLabels(): string[] {
  return vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => tab.input instanceof vscode.TabInputTextDiff)
    .map((tab) => tab.label);
}

/** `tabGroups` settles asynchronously after an editor opens, so anything asserting on it has to wait for the model to catch up rather than read it once. */
async function waitFor(description: string, condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`timed out after ${timeoutMs}ms waiting for ${description}`);
}

async function closeAllEditors(): Promise<void> {
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
}

// --- activation ------------------------------------------------------------

test("the extension activates in a real VS Code window", async () => {
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, `${EXTENSION_ID} was not found by the extension host`);
  await extension.activate();
  assert.equal(extension.isActive, true);
});

test("every contributed command is actually registered after activation", async () => {
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  await extension!.activate();

  const registered = new Set(await vscode.commands.getCommands(true));
  const contributed: string[] = (extension!.packageJSON as { contributes: { commands: { command: string }[] } }).contributes.commands.map(
    (entry) => entry.command,
  );

  assert.ok(contributed.length > 0, "package.json contributes no commands");
  for (const command of contributed) {
    assert.ok(registered.has(command), `${command} is contributed but never registered`);
  }
});

// --- diff review -----------------------------------------------------------

test("reviewDiff never opens a diff editor on its own - review happens in the chat card, opening is on demand", async () => {
  await closeAllEditors();
  const workspace = await makeWorkspace();
  const { host } = makeHost(workspace, workspace, { decision: "reject", reason: "not needed" });
  const first = join(workspace, "one.txt");
  const second = join(workspace, "two.txt");

  await host.reviewDiff([
    { path: first, originalContent: "", newContent: "one" },
    { path: second, originalContent: "", newContent: "two" },
  ]);

  assert.deepEqual(diffTabLabels(), [], "reviewDiff must not open an editor tab by itself");

  // the content is still registered and ready, though - opening it is one
  // `vscode.diff` call away (what `ChatPanel.openDiff` does once the user
  // actually clicks the diff card's "open in editor" button).
  const { originalUri, proposedUri } = diffUrisFor("test-session", first);
  await vscode.commands.executeCommand("vscode.diff", originalUri, proposedUri, `Review: ${first}`, { preview: false });
  await waitFor("the diff tab to open on demand", () => diffTabLabels().includes(`Review: ${first}`));
  await closeAllEditors();
});

test("the diff editor gets real syntax highlighting, not plaintext, for a recognized extension", async () => {
  await closeAllEditors();
  const workspace = await makeWorkspace();
  const target = join(workspace, "example.ts");
  const { host } = makeHost(workspace, workspace, { decision: "reject", reason: "not needed" });

  await host.reviewDiff([{ path: target, originalContent: "const a = 1;", newContent: "const a = 2;" }]);

  // the document model gets its language set as soon as the diff is
  // proposed (so it's correct the moment it's later shown) - it doesn't
  // require a visible tab, since `reviewDiff` no longer opens one itself.
  const { originalUri, proposedUri } = diffUrisFor("test-session", target);
  const originalDoc = vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === originalUri.toString());
  const proposedDoc = vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === proposedUri.toString());

  assert.ok(originalDoc, "the original virtual document was never opened");
  assert.ok(proposedDoc, "the proposed virtual document was never opened");
  // the bug this guards against: appending ".original"/".proposed" after
  // the real extension (`example.ts.original`) defeats VS Code's own
  // extension-based language detection, so both sides silently render as
  // plaintext instead of picking up the real `.ts` grammar.
  assert.equal(originalDoc!.languageId, "typescript", `expected typescript, got ${originalDoc!.languageId}`);
  assert.equal(proposedDoc!.languageId, "typescript", `expected typescript, got ${proposedDoc!.languageId}`);
  await closeAllEditors();
});

test("accepting a review reports accept and rejecting reports a reason", async () => {
  const workspace = await makeWorkspace();
  const edit = { path: join(workspace, "file.txt"), originalContent: "", newContent: "new" };

  const accepted = await makeHost(workspace, workspace, { decision: "accept" }).host.reviewDiff([edit]);
  assert.equal(accepted.decision, "accept");

  const rejected = await makeHost(workspace, workspace, { decision: "reject", reason: "not needed" }).host.reviewDiff([edit]);
  assert.equal(rejected.decision, "reject");
  assert.ok(rejected.reason, "a rejection must carry a reason back to the model");
  await closeAllEditors();
});

test("runCommand emits command_output as the process writes, not just the final buffered result", async () => {
  const workspace = await makeWorkspace();
  const { host, events } = makeHost(workspace);

  const result = await host.runCommand({ executable: process.execPath, args: ["-e", "process.stdout.write('hello '); process.stdout.write('world')"] });

  assert.equal(result.stdout, "hello world");
  const chunks = events.filter((event): event is { type: "command_output"; chunk: string } => (event as { type: string }).type === "command_output");
  assert.ok(chunks.length > 0, "expected at least one command_output event while the process ran");
  assert.equal(chunks.map((event) => event.chunk).join(""), "hello world");
});

test("runCommand kills the process when its signal aborts, instead of leaving it running", async () => {
  const workspace = await makeWorkspace();
  const { host } = makeHost(workspace);
  const controller = new AbortController();

  // A process that never exits on its own - proves the promise only
  // settles because the abort actually killed it, not because it finished
  // naturally within the timeout.
  const resultPromise = host.runCommand({ executable: process.execPath, args: ["-e", "setInterval(() => {}, 1000)"] }, controller.signal);
  setTimeout(() => controller.abort(), 200);

  const result = await resultPromise;
  assert.notEqual(result.exitCode, 0, "a killed process should not report success");
});

// --- the full loop ---------------------------------------------------------

test("full loop: the agent edits a file, the diff is accepted and the change lands on disk", async () => {
  await closeAllEditors();
  const workspace = await makeWorkspace();
  const target = join(workspace, "greeting.txt");
  await writeFile(target, "hello\n", "utf8");

  const { host, events } = makeHost(workspace);
  const provider = fakeProvider([
    {
      message: {
        role: "assistant",
        content: null,
        toolCalls: [{ id: "call_edit", name: "apply_patch", arguments: { edits: [{ path: target, content: "hello world\n" }] } }],
      },
      stopReason: "tool_use",
      usage: { inputTokens: 1, outputTokens: 1 },
    },
    {
      message: {
        role: "assistant",
        content: null,
        toolCalls: [{ id: "call_tests", name: "run_tests", arguments: { command: "node", args: ["-e", "process.exit(0)"] } }],
      },
      stopReason: "tool_use",
      usage: { inputTokens: 1, outputTokens: 1 },
    },
    { message: { role: "assistant", content: "Updated the greeting." }, stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } },
  ]);

  const { messages } = await withModalAnswers({ warning: "Allow" }, () =>
    runAgentLoop({ host, provider, model: "fake-model", messages: [{ role: "user", content: "say hello world" }] }),
  );

  assert.equal(await readFile(target, "utf8"), "hello world\n", "the accepted edit never reached disk");

  const toolResults = messages.filter((message) => message.role === "tool");
  assert.equal(toolResults.length, 2, "expected an apply_patch and a run_tests result");
  for (const result of toolResults) {
    const parsed = JSON.parse(result.role === "tool" ? result.content : "{}") as { ok: boolean; code?: string };
    assert.equal(parsed.ok, true, `tool call failed: ${parsed.code ?? "unknown"}`);
  }

  assert.equal(messages.at(-1)?.role, "assistant");
  assert.ok(
    events.some((event) => (event as { type?: string }).type === "diff_ready"),
    "the loop never emitted diff_ready, so nothing was reviewable",
  );
  await closeAllEditors();
});

test("a rejected diff leaves the file untouched and tells the model why", async () => {
  await closeAllEditors();
  const workspace = await makeWorkspace();
  const target = join(workspace, "untouched.txt");
  await writeFile(target, "original\n", "utf8");

  const { host } = makeHost(workspace, workspace, { decision: "reject", reason: "not needed" });
  const provider = fakeProvider([
    {
      message: {
        role: "assistant",
        content: null,
        toolCalls: [{ id: "call_edit", name: "apply_patch", arguments: { edits: [{ path: target, content: "rewritten\n" }] } }],
      },
      stopReason: "tool_use",
      usage: { inputTokens: 1, outputTokens: 1 },
    },
    { message: { role: "assistant", content: "Understood, leaving it as is." }, stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } },
  ]);

  const { messages } = await runAgentLoop({ host, provider, model: "fake-model", messages: [{ role: "user", content: "rewrite it" }] });

  assert.equal(await readFile(target, "utf8"), "original\n", "a rejected edit still wrote to disk");
  const toolResult = messages.find((message) => message.role === "tool");
  const parsed = JSON.parse(toolResult && toolResult.role === "tool" ? toolResult.content : "{}") as { ok: boolean; code?: string };
  assert.equal(parsed.ok, false);
  assert.equal(parsed.code, "EDIT_REJECTED");
  await closeAllEditors();
});

test("denying approval stops an approval-tier command from running", async () => {
  const workspace = await makeWorkspace();
  const marker = join(workspace, "should-not-exist.txt");
  const { host } = makeHost(workspace);

  const provider = fakeProvider([
    {
      message: {
        role: "assistant",
        content: null,
        toolCalls: [
          { id: "call_cmd", name: "run_command", arguments: { executable: "node", args: ["-e", `require("fs").writeFileSync(${JSON.stringify(marker)}, "x")`] } },
        ],
      },
      stopReason: "tool_use",
      usage: { inputTokens: 1, outputTokens: 1 },
    },
    { message: { role: "assistant", content: "Skipped." }, stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } },
  ]);

  const { messages } = await withModalAnswers({ warning: undefined }, () =>
    runAgentLoop({ host, provider, model: "fake-model", messages: [{ role: "user", content: "run it" }] }),
  );

  assert.equal(existsSync(marker), false, "a denied run_command still executed");
  const toolResult = messages.find((message) => message.role === "tool");
  const parsed = JSON.parse(toolResult && toolResult.role === "tool" ? toolResult.content : "{}") as { ok: boolean; code?: string };
  assert.equal(parsed.code, "APPROVAL_DENIED");
});

// --- commands --------------------------------------------------------------

test("paymodCode.newSession opens a session editor", async () => {
  await closeAllEditors();
  await vscode.extensions.getExtension(EXTENSION_ID)!.activate();

  await vscode.commands.executeCommand("paymodCode.newSession");

  await waitFor("a session webview panel to open", () =>
    vscode.window.tabGroups.all.flatMap((group) => group.tabs).some((tab) => tab.input instanceof vscode.TabInputWebview),
  );
  await closeAllEditors();
});

export async function run(): Promise<void> {
  const failures: string[] = [];

  for (const testCase of cases) {
    try {
      await testCase.fn();
      console.log(`ok - ${testCase.name}`);
    } catch (error) {
      failures.push(testCase.name);
      console.log(`not ok - ${testCase.name}`);
      console.error(error);
    }
  }

  console.log(`\n${cases.length - failures.length}/${cases.length} passed`);
  if (failures.length > 0) {
    throw new Error(`${failures.length} E2E test(s) failed: ${failures.join(", ")}`);
  }
}
