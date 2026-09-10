import { useEffect, useReducer, useRef } from "react";
import { commandLineFor, describeToolCall, filePathFor, type ConfigurableTool, type ContextMentionCategory, type ContextUsage, type ExtensionToWebviewMessage, type InferenceProviderId, type ModelMessage, type ModelUsage, type ProposedEdit, type RuleFile } from "@paymod/code-core/browser";
import { onExtensionMessage, postToExtension } from "./vscode-api";

const ZERO_USAGE: ModelUsage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };

export type ToolActivityItem = {
  kind: "tool";
  id: string;
  toolName: string;
  text: string;
  command: string | undefined;
  output: string | undefined;
  filePath: string | undefined;
};
export type TextItem = { kind: "text"; text: string; streaming: boolean };
export type DiffItem = { kind: "diff"; edits: ProposedEdit[]; resolved: "accept" | "reject" | undefined };
export type TurnActivityItem = ToolActivityItem | TextItem | DiffItem;

export type Turn = { userText: string; activity: TurnActivityItem[] };

type State = {
  signedIn: boolean;
  modelId: string;
  mode: "plan" | "act";
  ruleFiles: RuleFile[];
  configurableTools: ConfigurableTool[];
  byokProviders: InferenceProviderId[];
  usage: ModelUsage;
  contextUsage: ContextUsage | undefined;
  turns: Turn[];
  running: boolean;
  error: string | undefined;
  contextResults: Map<number, string[]>;
};

type Action =
  | {
      type: "hydrate";
      signedIn: boolean;
      modelId: string;
      mode: "plan" | "act";
      ruleFiles: RuleFile[];
      configurableTools: ConfigurableTool[];
      byokProviders: InferenceProviderId[];
      usage: ModelUsage;
      contextUsage: ContextUsage | undefined;
      messages: ModelMessage[];
    }
  | { type: "submitted"; text: string }
  | { type: "agentEvent"; event: NonNullable<Extract<ExtensionToWebviewMessage, { type: "agentEvent" }>["event"]> }
  | { type: "turnComplete"; contextUsage: ContextUsage | undefined }
  | { type: "error"; text: string }
  | { type: "diffDecision"; decision: "accept" | "reject" }
  | { type: "contextSearchResults"; requestId: number; results: string[] }
  | { type: "selectModel"; modelId: string }
  | { type: "setMode"; mode: "plan" | "act" }
  | { type: "toggleRuleFile"; path: string; enabled: boolean }
  | { type: "toggleAutoApprove"; toolName: string; enabled: boolean };

/** shared by the live `tool_result` event and by re-hydrating a persisted "tool" message on reload - both ultimately carry the same `{ok, data | code+message}` shape, just wrapped differently (a typed `AgentEvent` live, a JSON string on disk). */
function outputFromToolResult(ok: boolean, data: unknown, fallbackSummary: string): string | undefined {
  const typed = data as { stdout?: string; stderr?: string } | undefined;
  const output = ok && typed ? [typed.stdout, typed.stderr].filter(Boolean).join("\n").trim() : fallbackSummary.trim();
  return output || undefined;
}

function parsePersistedToolResult(content: string): { output: string | undefined } {
  try {
    const parsed = JSON.parse(content) as { ok: boolean; data?: unknown; code?: string; message?: string };
    const fallbackSummary = parsed.ok ? "" : `${parsed.code}: ${parsed.message}`;
    return { output: outputFromToolResult(parsed.ok, parsed.data, fallbackSummary) };
  } catch {
    return { output: undefined };
  }
}

function messagesToTurns(messages: ModelMessage[]): Turn[] {
  const turns: Turn[] = [];
  let current: Turn | undefined;
  for (const message of messages) {
    if (message.role === "user") {
      current = { userText: message.content, activity: [] };
      turns.push(current);
    } else if (message.role === "assistant" && current) {
      if (message.content) current.activity.push({ kind: "text", text: message.content, streaming: false });
      for (const call of message.toolCalls ?? []) {
        current.activity.push({
          kind: "tool",
          id: call.id,
          toolName: call.name,
          text: describeToolCall(call.name, call.arguments),
          command: commandLineFor(call.name, call.arguments),
          output: undefined,
          filePath: filePathFor(call.name, call.arguments),
        });
      }
    } else if (message.role === "tool" && current) {
      const index = current.activity.findIndex((item) => item.kind === "tool" && item.id === message.toolCallId);
      if (index !== -1) current.activity[index] = { ...(current.activity[index] as ToolActivityItem), ...parsePersistedToolResult(message.content) };
    }
  }
  return turns;
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "hydrate":
      return {
        ...state,
        signedIn: action.signedIn,
        modelId: action.modelId,
        mode: action.mode,
        ruleFiles: action.ruleFiles,
        configurableTools: action.configurableTools,
        byokProviders: action.byokProviders,
        usage: action.usage,
        contextUsage: action.contextUsage,
        turns: messagesToTurns(action.messages),
      };
    case "selectModel":
      return { ...state, modelId: action.modelId };
    case "setMode":
      return { ...state, mode: action.mode };
    case "toggleRuleFile":
      return { ...state, ruleFiles: state.ruleFiles.map((rule) => (rule.path === action.path ? { ...rule, enabled: action.enabled } : rule)) };
    case "toggleAutoApprove":
      return { ...state, configurableTools: state.configurableTools.map((tool) => (tool.name === action.toolName ? { ...tool, autoApproved: action.enabled } : tool)) };
    case "submitted":
      return { ...state, running: true, error: undefined, turns: [...state.turns, { userText: action.text, activity: [] }] };
    case "turnComplete":
      return { ...state, running: false, contextUsage: action.contextUsage ?? state.contextUsage };
    case "error":
      return { ...state, running: false, error: action.text };
    case "contextSearchResults": {
      const contextResults = new Map(state.contextResults);
      contextResults.set(action.requestId, action.results);
      return { ...state, contextResults };
    }
    case "diffDecision": {
      const turns = state.turns.slice();
      const last = turns.at(-1);
      if (!last) return state;
      const activity = last.activity.slice();
      const diffIndex = activity.findLastIndex((item) => item.kind === "diff" && !item.resolved);
      if (diffIndex === -1) return state;
      activity[diffIndex] = { ...(activity[diffIndex] as DiffItem), resolved: action.decision };
      turns[turns.length - 1] = { ...last, activity };
      return { ...state, turns };
    }
    case "agentEvent": {
      const event = action.event;
      const turns = state.turns.slice();
      const last = turns.at(-1);
      if (!last) return state;
      const activity = last.activity.slice();

      if (event.type === "text_delta") {
        const lastItem = activity.at(-1);
        if (lastItem && lastItem.kind === "text" && lastItem.streaming) {
          activity[activity.length - 1] = { ...lastItem, text: lastItem.text + event.delta };
        } else {
          activity.push({ kind: "text", text: event.delta, streaming: true });
        }
      } else if (event.type === "tool_call") {
        activity.push({
          kind: "tool",
          id: event.toolCall.id,
          toolName: event.toolCall.name,
          text: describeToolCall(event.toolCall.name, event.toolCall.arguments),
          command: commandLineFor(event.toolCall.name, event.toolCall.arguments),
          output: undefined,
          filePath: filePathFor(event.toolCall.name, event.toolCall.arguments),
        });
      } else if (event.type === "tool_result") {
        const index = activity.findIndex((item) => item.kind === "tool" && item.id === event.toolCallId);
        if (index !== -1) {
          const existing = activity[index] as ToolActivityItem;
          // a streamed `command_output` already accumulated the real, live
          // output - don't clobber it with the tool's own summary, which
          // for a failed command is just "Exit code 1" and would erase
          // everything the user just watched stream in.
          const output = existing.output ?? outputFromToolResult(event.ok, event.data, event.summary);
          activity[index] = { ...existing, output };
        }
      } else if (event.type === "command_output") {
        // tools execute strictly one at a time (see `runAgentLoop`), so the
        // most recently pushed tool item is always the one currently
        // running - no id correlation needed for this to land in the right
        // place.
        const lastItem = activity.at(-1);
        if (lastItem && lastItem.kind === "tool") {
          activity[activity.length - 1] = { ...lastItem, output: (lastItem.output ?? "") + event.chunk };
        }
      } else if (event.type === "diff_ready") {
        activity.push({ kind: "diff", edits: event.edits, resolved: undefined });
      } else if (event.type === "compaction") {
        // reuses the tool-activity rendering (icon + text line, no IN/OUT
        // block since `command`/`output` are undefined) rather than a new
        // activity kind - a minimal acknowledgment, not a rich view of the
        // compaction itself.
        activity.push({
          kind: "tool",
          id: event.recordId,
          toolName: "compaction",
          text: `Compacted ${event.sourceMessageCount} earlier messages to free up context space`,
          command: undefined,
          output: undefined,
          filePath: undefined,
        });
      } else if (event.type === "message_stop") {
        turns[turns.length - 1] = { ...last, activity };
        const usage = event.response.usage;
        return {
          ...state,
          turns,
          usage: {
            inputTokens: state.usage.inputTokens + usage.inputTokens,
            outputTokens: state.usage.outputTokens + usage.outputTokens,
            cachedInputTokens: (state.usage.cachedInputTokens ?? 0) + (usage.cachedInputTokens ?? 0),
          },
        };
      }
      // tool_call_delta doesn't drive UI state directly

      turns[turns.length - 1] = { ...last, activity };
      return { ...state, turns };
    }
    default:
      return state;
  }
}

const initialState: State = {
  signedIn: false,
  modelId: "",
  mode: "act",
  ruleFiles: [],
  configurableTools: [],
  byokProviders: [],
  usage: ZERO_USAGE,
  contextUsage: undefined,
  turns: [],
  running: false,
  error: undefined,
  contextResults: new Map(),
};

export function useAgentSession() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const contextRequestId = useRef(0);

  useEffect(() => {
    return onExtensionMessage((message) => {
      if (message.type === "sessionState") {
        dispatch({
          type: "hydrate",
          signedIn: message.signedIn,
          modelId: message.modelId,
          mode: message.mode,
          ruleFiles: message.ruleFiles,
          configurableTools: message.configurableTools,
          byokProviders: message.byokProviders,
          usage: message.usage,
          contextUsage: message.contextUsage,
          messages: message.messages,
        });
      }
      else if (message.type === "agentEvent") dispatch({ type: "agentEvent", event: message.event });
      else if (message.type === "turnComplete") dispatch({ type: "turnComplete", contextUsage: message.contextUsage });
      else if (message.type === "error") dispatch({ type: "error", text: message.text });
      else if (message.type === "contextSearchResults") dispatch({ type: "contextSearchResults", requestId: message.requestId, results: message.results });
    });
  }, []);

  function submit(text: string) {
    dispatch({ type: "submitted", text });
    postToExtension({ type: "submit", text });
  }

  function cancel() {
    postToExtension({ type: "cancel" });
  }

  function selectModel(modelId: string) {
    dispatch({ type: "selectModel", modelId });
    postToExtension({ type: "selectModel", modelId });
  }

  function setMode(mode: "plan" | "act") {
    dispatch({ type: "setMode", mode });
    postToExtension({ type: "setMode", mode });
  }

  function toggleRuleFile(path: string, enabled: boolean) {
    dispatch({ type: "toggleRuleFile", path, enabled });
    postToExtension({ type: "toggleRuleFile", path, enabled });
  }

  function toggleAutoApprove(toolName: string, enabled: boolean) {
    dispatch({ type: "toggleAutoApprove", toolName, enabled });
    postToExtension({ type: "toggleAutoApprove", toolName, enabled });
  }

  function decideDiff(decision: "accept" | "reject") {
    dispatch({ type: "diffDecision", decision });
    postToExtension({ type: "diffDecision", decision });
  }

  function searchContext(category: ContextMentionCategory, query: string): number {
    const requestId = ++contextRequestId.current;
    postToExtension({ type: "contextSearch", category, query, requestId });
    return requestId;
  }

  return { state, submit, cancel, selectModel, setMode, toggleRuleFile, toggleAutoApprove, decideDiff, searchContext };
}
