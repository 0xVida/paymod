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
import { FileCredentialStore } from "../auth/file-credential-store.js";

/**
 * the terminal `AgentHost` - mirrors `apps/code-extension/src/agent/vscode-host.ts`
 * minus vscode-specific concerns like diff-editor URIs and syntax highlighting.
 * diff review and approval prompts are injected as callbacks, the same
 * separation `VSCodeHost` uses, so the Ink UI and the `-p` path can prompt
 * differently without NodeHost knowing which mode it's running under.
 */
export class NodeHost implements AgentHost {
  private readonly credentials = new FileCredentialStore();

  constructor(
    readonly workspaceRoot: string,
    private readonly sessionId: string,
    private readonly sessionsDir: string,
    private readonly artifactsDir: string,
    private readonly compactionRecordsDir: string,
    private readonly onEvent: (event: AgentEvent) => void,
    private readonly requestDiffDecision: (edits: ProposedEdit[]) => Promise<DiffReviewResult>,
    private readonly requestToolApproval: (action: PendingAction) => Promise<boolean>,
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

  /** same streaming-output and abort-kills-the-child discipline as `VSCodeHost.runCommand` - a build or test watch shows output as it happens, and stopping a turn actually stops the process, not just the UI showing it. */
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

  reviewDiff(edits: ProposedEdit[]): Promise<DiffReviewResult> {
    return this.requestDiffDecision(edits);
  }

  requestApproval(action: PendingAction): Promise<boolean> {
    return this.requestToolApproval(action);
  }

  getCredential(): Promise<string | undefined> {
    return this.credentials.get();
  }

  setCredential(secret: string): Promise<void> {
    return this.credentials.set(secret);
  }

  clearCredential(): Promise<void> {
    return this.credentials.clear();
  }

  async openExternal(url: string): Promise<void> {
    const { default: open } = await import("open");
    await open(url);
  }

  readSession(id: string): Promise<Session | undefined> {
    return readSessionFile(this.sessionsDir, id);
  }

  /** metadata-only, same reasoning as `VSCodeHost.writeSession` - transcript persistence is the CLI's own session-runner's job (mirroring `ChatPanel`'s `SessionRegistry` split), not this generic path. */
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
