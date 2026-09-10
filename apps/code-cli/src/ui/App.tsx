import React, { useCallback, useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { Composer } from "./Composer.js";
import {
  contextUsagePercent,
  DEFAULT_SESSION_TITLE,
  diffLines,
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
import { NodeHost } from "../host/node-host.js";
import { systemPrompt } from "../provider.js";
import { persistTurn, renameSession } from "../session-runner.js";

type DisplayLine = { kind: "user" | "assistant" | "tool" | "command" | "system" | "error"; text: string };

type PendingPrompt =
  | { type: "diff"; edits: ProposedEdit[]; resolve: (result: DiffReviewResult) => void }
  | { type: "approval"; action: PendingAction; resolve: (approved: boolean) => void };

export type AppProps = {
  workspaceRoot: string;
  sessionId: string;
  sessionsDir: string;
  artifactsDir: string;
  compactionRecordsDir: string;
  provider: ModelProvider;
  model: string;
  initialTitle: string;
  initialSession: SessionTurnState;
  initialContextUsage?: ContextUsage;
};

function colorFor(kind: DisplayLine["kind"]): string | undefined {
  if (kind === "user") return "cyan";
  if (kind === "tool") return "yellow";
  if (kind === "command") return "gray";
  if (kind === "system") return "gray";
  if (kind === "error") return "red";
  return undefined;
}

function DiffPreview({ edits }: { edits: ProposedEdit[] }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      {edits.map((edit) => (
        <Box key={edit.path} flexDirection="column" marginBottom={1}>
          <Text bold>{edit.path}</Text>
          {diffLines(edit.originalContent, edit.newContent)
            .slice(0, 40)
            .map((line, index) => {
              const color = line.kind === "add" ? "green" : line.kind === "remove" ? "red" : undefined;
              return (
                <Text key={index} {...(color !== undefined && { color })}>
                  {line.kind === "add" ? "+ " : line.kind === "remove" ? "- " : "  "}
                  {line.text}
                </Text>
              );
            })}
        </Box>
      ))}
      <Text color="yellow">Accept these changes? [a]ccept / [r]eject</Text>
    </Box>
  );
}

function ApprovalPrompt({ action }: { action: PendingAction }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text bold>Allow {action.toolName}?</Text>
      <Text color="gray">{action.description}</Text>
      <Text color="yellow">[y]es / [n]o</Text>
    </Box>
  );
}

export function App({ workspaceRoot, sessionId, sessionsDir, artifactsDir, compactionRecordsDir, provider, model, initialTitle, initialSession, initialContextUsage }: AppProps) {
  const { exit } = useApp();
  const [lines, setLines] = useState<DisplayLine[]>([]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [pending, setPending] = useState<PendingPrompt | undefined>(undefined);
  const [contextUsage, setContextUsage] = useState<ContextUsage | undefined>(initialContextUsage);
  const sessionRef = useRef<SessionTurnState>(initialSession);
  const titleRef = useRef(initialTitle);
  const streamingRef = useRef("");

  const appendLine = useCallback((line: DisplayLine) => setLines((prev) => [...prev, line]), []);

  const requestDiffDecision = useCallback((edits: ProposedEdit[]): Promise<DiffReviewResult> => {
    return new Promise((resolve) => setPending({ type: "diff", edits, resolve }));
  }, []);

  const requestToolApproval = useCallback((action: PendingAction): Promise<boolean> => {
    return new Promise((resolve) => setPending({ type: "approval", action, resolve }));
  }, []);

  const handleEvent = useCallback(
    (event: AgentEvent) => {
      if (event.type === "text_delta") {
        streamingRef.current += event.delta;
        setLines((prev) => {
          const last = prev.at(-1);
          if (last?.kind === "assistant") return [...prev.slice(0, -1), { kind: "assistant", text: streamingRef.current }];
          return [...prev, { kind: "assistant", text: streamingRef.current }];
        });
      } else if (event.type === "tool_call") {
        appendLine({ kind: "tool", text: `-> ${event.toolCall.name}(${JSON.stringify(event.toolCall.arguments)})` });
      } else if (event.type === "tool_result") {
        appendLine({ kind: "tool", text: `${event.ok ? "OK" : "FAIL"} ${event.summary}` });
      } else if (event.type === "command_output") {
        appendLine({ kind: "command", text: event.chunk.trimEnd() });
      } else if (event.type === "compaction") {
        appendLine({ kind: "system", text: `Compacted ${event.sourceMessageCount} earlier messages to free up context space.` });
      } else if (event.type === "message_stop") {
        streamingRef.current = "";
      }
    },
    [appendLine],
  );

  const submit = useCallback(
    async (text: string) => {
      if (!text.trim() || running) return;
      setInput("");
      appendLine({ kind: "user", text });
      setRunning(true);

      // names the session from its first message (like Claude Code and Cursor do),
      // but only while it still has the untouched default title, so a session
      // already renamed by hand is never overwritten. mirrors `chat-panel.ts`'s gate.
      if (sessionRef.current.transcript.length === 0 && titleRef.current === DEFAULT_SESSION_TITLE) {
        titleRef.current = titleFromPrompt(text);
        void renameSession(sessionsDir, sessionId, titleRef.current);
      }

      const host = new NodeHost(workspaceRoot, sessionId, sessionsDir, artifactsDir, compactionRecordsDir, handleEvent, requestDiffDecision, requestToolApproval);

      try {
        const result = await runSessionTurn({
          host,
          provider,
          model,
          sessionId,
          systemPrompt: systemPrompt(workspaceRoot),
          session: sessionRef.current,
          userMessage: text,
          lastContextUsage: contextUsage,
        });
        sessionRef.current = { transcript: result.transcript, activeCompaction: result.activeCompaction, originalTask: result.originalTask };
        if (result.contextUsage) setContextUsage(result.contextUsage);
        await persistTurn(sessionsDir, sessionId, model, result);
      } catch (error) {
        appendLine({ kind: "error", text: error instanceof Error ? error.message : "Something went wrong." });
      } finally {
        setRunning(false);
      }
    },
    [appendLine, artifactsDir, compactionRecordsDir, handleEvent, model, provider, requestDiffDecision, requestToolApproval, running, sessionId, sessionsDir, workspaceRoot],
  );

  useInput((char, key) => {
    if (!pending) {
      if (key.escape || (key.ctrl && char === "c")) exit();
      return;
    }
    if (pending.type === "diff") {
      if (char === "a") {
        pending.resolve({ decision: "accept" });
        setPending(undefined);
      } else if (char === "r") {
        pending.resolve({ decision: "reject" });
        setPending(undefined);
      }
    } else if (pending.type === "approval") {
      if (char === "y") {
        pending.resolve(true);
        setPending(undefined);
      } else if (char === "n") {
        pending.resolve(false);
        setPending(undefined);
      }
    }
  });

  return (
    <Box flexDirection="column">
      {lines.map((line, index) => {
        const color = colorFor(line.kind);
        return (
          <Text key={index} {...(color !== undefined && { color })}>
            {line.kind === "user" ? "> " : ""}
            {line.text}
          </Text>
        );
      })}
      {running && !pending && <Text color="gray">Thinking...</Text>}
      {pending?.type === "diff" && <DiffPreview edits={pending.edits} />}
      {pending?.type === "approval" && <ApprovalPrompt action={pending.action} />}
      {!running && !pending && contextUsage && (
        <Text color={contextUsage.shouldCompact ? "yellow" : "gray"}>
          context: {contextUsagePercent(contextUsage).toFixed(0)}% ({contextUsage.usedTokens.toLocaleString()} / {contextUsage.contextWindow.toLocaleString()} tokens)
          {contextUsage.shouldCompact ? " - approaching limit" : ""}
        </Text>
      )}
      {!running && !pending && <Composer value={input} onChange={setInput} onSubmit={submit} />}
    </Box>
  );
}
