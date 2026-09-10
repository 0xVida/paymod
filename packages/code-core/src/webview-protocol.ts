import type { ModelMessage, ModelUsage } from "./model/types.js";
import type { AgentEvent } from "./host.js";
import type { ContextUsage } from "./agent/context-policy.js";

/** what a composer "@" mention can search - files and folders come from the real workspace, problems from the diagnostics the editor already has, commits from `git log`. */
export type ContextMentionCategory = "file" | "folder" | "problem" | "gitCommit";

export type RuleFile = { path: string; enabled: boolean };

export type ConfigurableTool = { name: string; description: string; autoApproved: boolean };

/** providers a BYOK key is currently stored for - a model whose provider appears here runs on that key instead of Paymod's proxy/balance. */
export type InferenceProviderId = "openai" | "anthropic";

/**
 * the typed contract between `ChatPanel` (extension host) and the React webview - one
 * shared TS union both sides import, not ad-hoc `postMessage({ type: "...", ... })`
 * shapes accumulated one at a time. `agentEvent` wraps the existing `AgentEvent` union
 * unchanged since the runtime's own event stream is already the typed model this exposes.
 */
export type WebviewToExtensionMessage =
  | { type: "ready" }
  | { type: "submit"; text: string }
  | { type: "cancel" }
  | { type: "selectModel"; modelId: string }
  | { type: "setMode"; mode: "plan" | "act" }
  | { type: "diffDecision"; decision: "accept" | "reject" }
  | { type: "contextSearch"; category: ContextMentionCategory; query: string; requestId: number }
  | { type: "attachFiles" }
  | { type: "toggleRuleFile"; path: string; enabled: boolean }
  | { type: "toggleAutoApprove"; toolName: string; enabled: boolean }
  | { type: "openFile"; path: string; range?: { start: number; end: number } }
  | { type: "openDiff"; path: string };

export type ExtensionToWebviewMessage =
  | {
      type: "sessionState";
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
  | { type: "agentEvent"; event: AgentEvent }
  | { type: "contextSearchResults"; requestId: number; results: string[] }
  | { type: "attachFilesResult"; paths: string[] }
  | { type: "turnComplete"; contextUsage: ContextUsage | undefined }
  | { type: "error"; text: string };
