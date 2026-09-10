import type { ModelEvent, ModelToolCall } from "./model/types.js";
import type { ContextUsage } from "./agent/context-policy.js";

export type Session = {
  id: string;
  title: string;
  project: string;
  modelId: string;
  lastActivity: string;
  /** plan gathers information and proposes an approach without editing; Act executes normally. Optional because sessions persisted before this field existed have none on disk - callers default to "act". */
  mode?: "plan" | "act";
  /** workspace-relative paths of discovered rule files (CLAUDE.md, AGENTS.md, etc.) the user has excluded from the system prompt. Optional for the same reason as `mode`. */
  disabledRuleFiles?: string[];
  /** names of "configurable"-tier tools (see agent/permissions.ts) the user has chosen to auto-approve for this session, skipping the approval prompt. Optional for the same reason as `mode`. */
  autoApprovedTools?: string[];
  /** cumulative token usage across every turn in this session - real figures from each completion's own reported usage, not an estimate. Optional for the same reason as `mode`. */
  usage?: { inputTokens: number; outputTokens: number; cachedInputTokens: number };
  /** how full the model's context window is, as of the most recently completed turn (`runAgentLoop`'s `AgentLoopResult.contextUsage`) - a real per-turn measurement, not a cumulative sum like `usage` above. Undefined until a turn has completed with a registered model. */
  contextUsage?: ContextUsage;
  /** starred in the session list, independent of `lastActivity` - lets a session stay easy to find without being recently touched. Optional for the same reason as `mode`. */
  favorite?: boolean;
};

export type ProposedEdit = {
  path: string;
  originalContent: string;
  newContent: string;
};

export type PendingAction = {
  toolName: string;
  description: string;
  toolCall: ModelToolCall;
};

export type CommandSpec = {
  executable: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
};

export type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type DirectoryEntry = { name: string; isDirectory: boolean };

/**
 * full, uncapped tool output, persisted separately from `StoredSession.messages`
 * so a large `read_file`/`run_command`/`git_diff` result can be capped before
 * it re-enters the model's context without the rest being genuinely lost -
 * see `agent/tools/capping.ts` and the `get_artifact` tool.
 */
export type ToolArtifact = { toolCallId: string; toolName: string; createdAt: string; ok: boolean; fullContent: string };

/**
 * Structured, not prose, so losing one sentence of a summary can't silently erase state
 * the model still needs. This is exactly what `compactionSnapshotSchema` validates:
 * semantic content only. `version`/`createdAt` are deliberately not here: an LLM's claim
 * about those isn't trustworthy the way its summary is, so they're application-set - see `CompactionSnapshot` below.
 */
export type CompactionSnapshotContent = {
  objective: string;
  userConstraints: string[];
  decisions: Array<{ decision: string; rationale?: string | undefined }>;
  implementationState: { completed: string[]; inProgress: string[]; remaining: string[] };
  files: Array<{ path: string; relevance: string; changes?: string | undefined }>;
  symbols: Array<{ name: string; file?: string | undefined; relevance: string }>;
  failures: Array<{ command?: string | undefined; error: string; status: "OPEN" | "RESOLVED" }>;
  validation: string[];
  unresolved: string[];
  importantFacts: string[];
};

/** `CompactionSnapshotContent` plus the fields application code sets after validating it, never trusted from the model. */
export type CompactionSnapshot = CompactionSnapshotContent & {
  version: number;
  createdAt: string;
};

/**
 * the debuggability audit trail for a compaction - persisted, never read back
 * programmatically (active-compaction state reads `StoredSession.activeCompaction`
 * directly, not this record). `compactedThroughId` is a stable `TranscriptEntry.id`, not
 * a positional index, which would go stale once a second compaction shifts everything after it.
 */
export type CompactionRecord = {
  id: string;
  sessionId: string;
  compactedThroughId: string;
  sourceMessageCount: number;
  snapshot: CompactionSnapshot;
  model: string;
  inputTokens: number;
  outputTokens: number;
  trigger: "AUTO" | "MANUAL";
  focus?: string;
  createdAt: string;
};

export type DiffReviewResult = { decision: "accept" | "reject"; reason?: string };

export type AgentEvent =
  | { type: "text_delta"; delta: string }
  | { type: "tool_call"; toolCall: ModelToolCall }
  | { type: "tool_result"; toolCallId: string; ok: boolean; summary: string; data?: unknown }
  | { type: "command_output"; chunk: string }
  | { type: "diff_ready"; edits: ProposedEdit[] }
  | { type: "approval_needed"; action: PendingAction }
  | { type: "compaction"; recordId: string; sourceMessageCount: number; retainedMessageCount: number }
  | ModelEvent;

/**
 * the seam between the host-agnostic agent core and a specific surface (VS Code, a
 * terminal). Tools take an `AgentHost` and never import a host-specific API (`vscode`,
 * `child_process`) directly, so the agent loop, tools and providers run unchanged under any host.
 */
export interface AgentHost {
  readonly workspaceRoot: string;

  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  listDirectory(path: string): Promise<DirectoryEntry[]>;
  /** kills the spawned process when `signal` aborts, rather than leaving it running in the background after the user stops the turn. */
  runCommand(spec: CommandSpec, signal?: AbortSignal): Promise<CommandResult>;

  reviewDiff(edits: ProposedEdit[]): Promise<DiffReviewResult>;
  requestApproval(action: PendingAction): Promise<boolean>;

  getCredential(): Promise<string | undefined>;
  setCredential(secret: string): Promise<void>;
  clearCredential(): Promise<void>;

  openExternal(url: string): Promise<void>;

  readSession(id: string): Promise<Session | undefined>;
  writeSession(session: Session): Promise<void>;

  /**
   * no `sessionId` parameter, unlike `readSession`/`writeSession`: tools only ever
   * receive `host`, never the loop's session id, so the implementation must already know
   * which session it's scoped to (via its own constructor, same as `reviewDiff`/`emit`).
   */
  saveArtifact(artifact: ToolArtifact): Promise<void>;
  readArtifact(toolCallId: string): Promise<ToolArtifact | undefined>;

  saveCompactionRecord(record: CompactionRecord): Promise<void>;

  emit(event: AgentEvent): void;
}
