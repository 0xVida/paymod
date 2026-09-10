import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AgentEvent, AgentHost, CommandResult, CommandSpec, CompactionRecord, DiffReviewResult, DirectoryEntry, PendingAction, ProposedEdit, Session, ToolArtifact } from "../host.js";

/**
 * a real, filesystem-and-process-backed `AgentHost` for tests - tool tests run against a
 * real temp directory and a real `git` binary, not an in-memory fake, matching this
 * repo's bias toward testing the real thing. `apps/code-cli`'s `NodeHost` is the
 * production version of the same idea
 */
export class RealHost implements AgentHost {
  readonly events: AgentEvent[] = [];
  readonly sessions = new Map<string, Session>();
  readonly artifacts = new Map<string, ToolArtifact>();
  readonly compactionRecords: CompactionRecord[] = [];
  reviewDecision: DiffReviewResult = { decision: "accept" };
  approvalDecision = true;

  constructor(readonly workspaceRoot: string) {}

  readFile(path: string): Promise<string> {
    return readFile(path, "utf8");
  }

  async writeFile(path: string, content: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
  }

  async listDirectory(path: string): Promise<DirectoryEntry[]> {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }));
  }

  runCommand(spec: CommandSpec): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(spec.executable, spec.args, { cwd: spec.cwd ?? this.workspaceRoot, env: { ...process.env, ...spec.env } });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
      child.on("error", reject);
      child.on("close", (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }));
    });
  }

  async reviewDiff(_edits: ProposedEdit[]): Promise<DiffReviewResult> {
    return this.reviewDecision;
  }

  async requestApproval(_action: PendingAction): Promise<boolean> {
    return this.approvalDecision;
  }

  async getCredential(): Promise<string | undefined> {
    return undefined;
  }

  async setCredential(_secret: string): Promise<void> {}
  async clearCredential(): Promise<void> {}
  async openExternal(_url: string): Promise<void> {}

  async readSession(id: string): Promise<Session | undefined> {
    return this.sessions.get(id);
  }

  async writeSession(session: Session): Promise<void> {
    this.sessions.set(session.id, session);
  }

  async saveArtifact(artifact: ToolArtifact): Promise<void> {
    this.artifacts.set(artifact.toolCallId, artifact);
  }

  async readArtifact(toolCallId: string): Promise<ToolArtifact | undefined> {
    return this.artifacts.get(toolCallId);
  }

  async saveCompactionRecord(record: CompactionRecord): Promise<void> {
    this.compactionRecords.push(record);
  }

  emit(event: AgentEvent): void {
    this.events.push(event);
  }
}
