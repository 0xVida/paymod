import type { AgentEvent, AgentHost, CommandResult, CommandSpec, CompactionRecord, DiffReviewResult, DirectoryEntry, PendingAction, ProposedEdit, Session, ToolArtifact } from "../host.js";

/** in-memory `AgentHost`, used by both the agent-loop tests and as a template for a real host's shape. */
export class FakeHost implements AgentHost {
  readonly workspaceRoot = "/workspace";
  readonly events: AgentEvent[] = [];
  readonly files = new Map<string, string>();
  readonly sessions = new Map<string, Session>();
  readonly artifacts = new Map<string, ToolArtifact>();
  readonly compactionRecords: CompactionRecord[] = [];

  reviewDecision: DiffReviewResult = { decision: "accept" };
  approvalDecision = true;
  commandResult: CommandResult = { stdout: "", stderr: "", exitCode: 0 };

  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`No such file: ${path}`);
    return content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async listDirectory(_path: string): Promise<DirectoryEntry[]> {
    return [];
  }

  async runCommand(_spec: CommandSpec): Promise<CommandResult> {
    return this.commandResult;
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
