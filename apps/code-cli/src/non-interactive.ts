import {
  DEFAULT_SESSION_TITLE,
  formatContextUsageLine,
  getPermissionTier,
  runSessionTurn,
  titleFromPrompt,
  type AgentEvent,
  type ContextUsage,
  type DiffReviewResult,
  type ModelProvider,
  type PendingAction,
  type ProposedEdit,
  type SessionTurnState,
} from "@paymod/code-core";
import { NodeHost } from "./host/node-host.js";
import { systemPrompt } from "./provider.js";
import { persistTurn, renameSession } from "./session-runner.js";

/**
 * `paymod-code -p "<prompt>"` - one turn of the same agent loop, no Ink
 * render, plain stdout. no human is there to answer approval prompts, so
 * tools default to their configured tier - `apply_patch` is `auto`-tier
 * already (its diff review is the safety gate), while `approval`-tier
 * tools like `run_command` fail closed instead of running unattended.
 */
export async function runNonInteractive(params: {
  prompt: string;
  workspaceRoot: string;
  sessionId: string;
  sessionsDir: string;
  artifactsDir: string;
  compactionRecordsDir: string;
  provider: ModelProvider;
  model: string;
  initialTitle: string;
  initialSession: SessionTurnState;
  lastContextUsage: ContextUsage | undefined;
}): Promise<void> {
  if (params.initialSession.transcript.length === 0 && params.initialTitle === DEFAULT_SESSION_TITLE) {
    await renameSession(params.sessionsDir, params.sessionId, titleFromPrompt(params.prompt));
  }

  const onEvent = (event: AgentEvent) => {
    if (event.type === "text_delta") process.stdout.write(event.delta);
    else if (event.type === "tool_call") process.stdout.write(`\n[${event.toolCall.name}]\n`);
    else if (event.type === "command_output") process.stdout.write(event.chunk);
    else if (event.type === "compaction") {
      process.stderr.write(`\n[compacted ${event.sourceMessageCount} earlier messages]\n`);
    }
  };

  const requestDiffDecision = async (_edits: ProposedEdit[]): Promise<DiffReviewResult> => ({ decision: "accept" });

  const requestToolApproval = async (action: PendingAction): Promise<boolean> => {
    return getPermissionTier(action.toolName) !== "approval";
  };

  const host = new NodeHost(
    params.workspaceRoot,
    params.sessionId,
    params.sessionsDir,
    params.artifactsDir,
    params.compactionRecordsDir,
    onEvent,
    requestDiffDecision,
    requestToolApproval,
  );

  const result = await runSessionTurn({
    host,
    provider: params.provider,
    model: params.model,
    sessionId: params.sessionId,
    systemPrompt: systemPrompt(params.workspaceRoot),
    session: params.initialSession,
    userMessage: params.prompt,
    lastContextUsage: params.lastContextUsage,
  });
  await persistTurn(params.sessionsDir, params.sessionId, params.model, result);
  process.stdout.write("\n");
  // stderr, not stdout - this is meta information about the run, not part
  // of whatever the caller might be piping/parsing from stdout.
  if (result.contextUsage) process.stderr.write(`${formatContextUsageLine(result.contextUsage)}\n`);
}
