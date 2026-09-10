import * as vscode from "vscode";
import { spawn } from "node:child_process";
import { mkdir, readFile as fsReadFile, readdir, writeFile as fsWriteFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  readArtifact,
  readSessionFile,
  saveArtifact,
  saveCompactionRecord,
  writeSessionFile,
  type AgentEvent,
  type AgentHost,
  type CommandResult,
  type CommandSpec,
  type CompactionRecord,
  type DiffReviewResult,
  type DirectoryEntry,
  type PendingAction,
  type ProposedEdit,
  type Session,
  type StoredSession,
  type ToolArtifact,
} from "@paymod/code-core";
import type { CredentialStore } from "../auth/credential-store.js";
import { diffUrisFor, type DiffContentProvider } from "./diff-content-provider.js";

/**
 * VS Code has no public API to map an extension to its language id, only a
 * static `contributes.languages` manifest per extension, so this has to be
 * hand-listed. Covers what a coding agent touches most; anything unlisted
 * falls back to no explicit language.
 */
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: "typescript", tsx: "typescriptreact", js: "javascript", jsx: "javascriptreact", mjs: "javascript", cjs: "javascript",
  json: "json", jsonc: "jsonc", py: "python", rb: "ruby", go: "go", rs: "rust", java: "java", kt: "kotlin", swift: "swift",
  c: "c", h: "c", cpp: "cpp", cc: "cpp", hpp: "cpp", cs: "csharp", php: "php",
  html: "html", css: "css", scss: "scss", less: "less", md: "markdown", mdx: "mdx",
  yaml: "yaml", yml: "yaml", toml: "toml", xml: "xml", sql: "sql",
  sh: "shellscript", bash: "shellscript", zsh: "shellscript",
  dockerfile: "dockerfile", makefile: "makefile", vue: "vue", svelte: "svelte", graphql: "graphql", proto: "proto",
};

function languageIdForPath(path: string): string | undefined {
  const base = path.split(/[/\\]/).pop() ?? path;
  if (base.toLowerCase() === "dockerfile") return "dockerfile";
  if (base.toLowerCase() === "makefile") return "makefile";
  const extension = base.includes(".") ? base.slice(base.lastIndexOf(".") + 1).toLowerCase() : "";
  return LANGUAGE_BY_EXTENSION[extension];
}

/** once a batch is decided, its diff tabs are stale (accepted: the real file has moved past them; rejected: there is nothing left to review) - closes them rather than leaving dead tabs for the user to clean up by hand. */
async function closeDiffTabs(proposedUris: vscode.Uri[]): Promise<void> {
  const targets = new Set(proposedUris.map((uri) => uri.toString()));
  const tabs = vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => tab.input instanceof vscode.TabInputTextDiff && targets.has(tab.input.modified.toString()));
  if (tabs.length > 0) await vscode.window.tabGroups.close(tabs);
}

/** the VS Code implementation of `@paymod/code-core`'s `AgentHost`: everything the agent loop and tools need, backed by real fs/child_process/vscode APIs. */
export class VSCodeHost implements AgentHost {
  constructor(
    readonly workspaceRoot: string,
    private readonly sessionId: string,
    private readonly credentials: CredentialStore,
    private readonly diffProvider: DiffContentProvider,
    private readonly sessionsDir: string,
    private readonly artifactsDir: string,
    private readonly compactionRecordsDir: string,
    private readonly onEvent: (event: AgentEvent) => void,
    private readonly requestDiffDecision: (edits: ProposedEdit[]) => Promise<DiffReviewResult>,
    private readonly getAutoApprovedTools: () => readonly string[],
  ) {}

  readFile(path: string): Promise<string> {
    return fsReadFile(path, "utf8");
  }

  async writeFile(path: string, content: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await fsWriteFile(path, content, "utf8");
  }

  async listDirectory(path: string): Promise<DirectoryEntry[]> {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }));
  }

  /**
   * Streams `command_output` as stdout/stderr arrive instead of buffering
   * to the end - otherwise a long-running build or test watch looks hung
   * in the chat until it exits. Kills the child process on `signal` abort
   * since nothing else does.
   */
  runCommand(spec: CommandSpec, signal?: AbortSignal): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(spec.executable, spec.args, { cwd: spec.cwd ?? this.workspaceRoot, env: { ...process.env, ...spec.env } });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
        this.emit({ type: "command_output", chunk: text });
      });
      child.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        this.emit({ type: "command_output", chunk: text });
      });
      const onAbort = () => child.kill();
      signal?.addEventListener("abort", onAbort);
      child.on("error", (error) => {
        signal?.removeEventListener("abort", onAbort);
        reject(error);
      });
      child.on("close", (code) => {
        signal?.removeEventListener("abort", onAbort);
        resolve({ stdout, stderr, exitCode: code ?? 1 });
      });
    });
  }

  /**
   * Registers the proposed content and sets its language, but never opens
   * an editor tab - review happens in the chat's diff card. A real diff
   * editor only appears when the user clicks "open in editor"
   * (`ChatPanel.openDiff`).
   */
  async reviewDiff(edits: ProposedEdit[]): Promise<DiffReviewResult> {
    const proposedUris: vscode.Uri[] = [];
    for (const edit of edits) {
      const { originalUri, proposedUri } = diffUrisFor(this.sessionId, edit.path);
      this.diffProvider.set(originalUri, edit.originalContent);
      this.diffProvider.set(proposedUri, edit.newContent);
      proposedUris.push(proposedUri);

      // the virtual URI ends in ".original"/".proposed", not the real
      // extension, so VS Code can't infer the language itself. Opening each
      // document and setting its language from the real path is what gets
      // real syntax highlighting once the diff editor is shown.
      const languageId = languageIdForPath(edit.path);
      if (languageId) {
        const originalDoc = await vscode.workspace.openTextDocument(originalUri);
        await vscode.languages.setTextDocumentLanguage(originalDoc, languageId);
        const proposedDoc = await vscode.workspace.openTextDocument(proposedUri);
        await vscode.languages.setTextDocumentLanguage(proposedDoc, languageId);
      }
    }

    const result = await this.requestDiffDecision(edits);
    await closeDiffTabs(proposedUris);
    return result;
  }

  async requestApproval(action: PendingAction): Promise<boolean> {
    if (this.getAutoApprovedTools().includes(action.toolName)) return true;
    const choice = await vscode.window.showWarningMessage(`Allow ${action.toolName}?`, { modal: true, detail: action.description }, "Allow");
    return choice === "Allow";
  }

  getCredential(): Promise<string | undefined> {
    return Promise.resolve(this.credentials.get());
  }

  async setCredential(secret: string): Promise<void> {
    await this.credentials.set(secret);
  }

  async clearCredential(): Promise<void> {
    await this.credentials.clear();
  }

  async openExternal(url: string): Promise<void> {
    await vscode.env.openExternal(vscode.Uri.parse(url));
  }

  readSession(id: string): Promise<Session | undefined> {
    return readSessionFile(this.sessionsDir, id);
  }

  /** metadata-only: preserves whatever transcript already exists on disk. `ChatPanel` manages transcript persistence directly via `SessionRegistry`, not through this generic path. */
  async writeSession(session: Session): Promise<void> {
    const existing = await readSessionFile(this.sessionsDir, session.id);
    const stored: StoredSession = { ...session, transcript: existing?.transcript ?? [], activeCompaction: existing?.activeCompaction, originalTask: existing?.originalTask };
    await writeSessionFile(this.sessionsDir, stored);
  }

  saveArtifact(artifact: ToolArtifact): Promise<void> {
    return saveArtifact(this.artifactsDir, this.sessionId, artifact);
  }

  readArtifact(toolCallId: string): Promise<ToolArtifact | undefined> {
    return readArtifact(this.artifactsDir, this.sessionId, toolCallId);
  }

  saveCompactionRecord(record: CompactionRecord): Promise<void> {
    return saveCompactionRecord(this.compactionRecordsDir, this.sessionId, record);
  }

  emit(event: AgentEvent): void {
    this.onEvent(event);
  }
}
