/**
 * the browser-safe subset of `@paymod/code-core`'s public API - types and pure functions
 * only, nothing touching `node:fs`/`node:child_process`. The main `index.ts` barrel
 * re-exports the full Node-side API, and bundling that into a webview build pulls in
 * real Node built-ins a bundler can't shim (Vite fails on `realpath` from
 * `workspace-path.ts` the moment anything imports the root barrel). The React webview
 * imports from here (`@paymod/code-core/browser`) instead.
 */
export type { AgentEvent, ProposedEdit, PendingAction, DiffReviewResult } from "./host.js";
export type { ModelMessage, ModelToolCall, ModelEvent, ModelUsage } from "./model/types.js";
export { MODEL_REGISTRY, getModelDescriptor, type ModelDescriptor } from "./model/registry.js";
export { contextUsagePercent, type ContextUsage } from "./agent/context-policy.js";
export type { WebviewToExtensionMessage, ExtensionToWebviewMessage, ContextMentionCategory, RuleFile, ConfigurableTool, InferenceProviderId } from "./webview-protocol.js";
export { diffLines, compactDiffLines, changedLineRange, type DiffLine, type DiffLineKind } from "./diff.js";
export { commandLineFor, describeToolCall, filePathFor } from "./tool-display.js";
