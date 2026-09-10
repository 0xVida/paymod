import * as vscode from "vscode";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  AnthropicProvider,
  OpenAiProvider,
  getConfigurableTools,
  getModelDescriptor,
  runSessionTurn,
  type AgentEvent,
  type ConfigurableTool,
  type ContextMentionCategory,
  type ContextUsage,
  type DiffReviewResult,
  type ExtensionToWebviewMessage,
  type ModelProvider,
  type ModelUsage,
  type ProposedEdit,
  type RuleFile,
  type WebviewToExtensionMessage,
  titleFromPrompt,
} from "@paymod/code-core";
import type { AuthState } from "../auth/auth-state.js";
import type { SessionRegistry } from "../sessions/session-store.js";
import { DEFAULT_SESSION_TITLE } from "./types.js";
import { VSCodeHost } from "../agent/vscode-host.js";
import type { CredentialStore } from "../auth/credential-store.js";
import type { ByokKeyStore } from "../auth/byok-key-store.js";
import type { BalanceState } from "../auth/balance-state.js";
import { diffUrisFor, type DiffContentProvider } from "../agent/diff-content-provider.js";
import { renderReactWebviewHtml } from "./react-webview-loader.js";

const execFileAsync = promisify(execFile);

export type AgentDependencies = {
  credentials: CredentialStore;
  byokStore: ByokKeyStore;
  diffProvider: DiffContentProvider;
  sessionsDir: string;
  artifactsDir: string;
  compactionRecordsDir: string;
  balanceState: BalanceState;
};

// candidate rule-file names, checked at the workspace root - the same
// convention Claude Code, Cursor and Cline each use under their own name.
const RULE_FILE_CANDIDATES = ["CLAUDE.md", "AGENTS.md", "rules.md", ".clinerules", ".cursorrules"];
const FIND_FILES_EXCLUDE = "**/{node_modules,.git,dist,build,.next,out}/**";

const BYOK_BASE_URL: Record<"openai" | "anthropic", string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
};

function getApiUrl(): string {
  return vscode.workspace.getConfiguration("paymodCode").get<string>("apiUrl", "http://localhost:3001");
}

/** `byok: true` sends the request straight to the real provider with the user's own key - no Paymod proxy, no Paymod balance touched, no billing artifact created for that call (see PAYMOD_CODE_PLAN.md section 3). */
function buildProvider(modelId: string, apiKey: string, byok: boolean): ModelProvider {
  const descriptor = getModelDescriptor(modelId);
  if (!descriptor) throw new Error(`Unknown model: ${modelId}`);
  const baseUrl = byok ? BYOK_BASE_URL[descriptor.provider] : `${getApiUrl()}/v1/code/inference/${descriptor.provider}`;
  return descriptor.provider === "openai" ? new OpenAiProvider({ baseUrl, apiKey }) : new AnthropicProvider({ baseUrl, apiKey });
}

function systemPrompt(workspaceRoot: string, mode: "plan" | "act", rulesText: string): string {
  let prompt =
    `You are Paymod Code, an AI coding agent working in a real repository at ${workspaceRoot}. ` +
    "Use the available tools to read files, search the codebase, propose edits and run commands or tests. " +
    "Edits are shown to the user as a diff for review before anything is written. Make real changes rather than only describing them.";
  if (mode === "plan") {
    prompt +=
      " You are in Plan mode: investigate the codebase and describe the approach you would take, but do not call apply_patch or run a mutating command yet - wait for the user to switch to Act mode before making changes.";
  }
  prompt +=
    ' When you need the user to choose between a small number of discrete options, end your reply with a line reading "Options:" followed by each option on its own line prefixed with "-" - they render as clickable buttons instead of requiring free text.';
  if (rulesText) prompt += `\n\nProject rules:\n${rulesText}`;
  return prompt;
}

async function discoverRuleFiles(workspaceRoot: string, disabled: readonly string[]): Promise<RuleFile[]> {
  const found: RuleFile[] = [];
  for (const name of RULE_FILE_CANDIDATES) {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(path.join(workspaceRoot, name)));
      found.push({ path: name, enabled: !disabled.includes(name) });
    } catch {
      // not present in this workspace - not a rule file candidate here.
    }
  }
  return found;
}

async function readEnabledRuleFilesText(workspaceRoot: string, ruleFiles: readonly RuleFile[]): Promise<string> {
  const sections: string[] = [];
  for (const rule of ruleFiles) {
    if (!rule.enabled) continue;
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(path.join(workspaceRoot, rule.path)));
      sections.push(`--- ${rule.path} ---\n${Buffer.from(bytes).toString("utf8")}`);
    } catch {
      // deleted or unreadable since discovery - skip rather than fail the turn.
    }
  }
  return sections.join("\n\n");
}

/**
 * one controller per session, not a global singleton - owns one
 * `VSCodeHost` and renders into either a `WebviewPanel` (editor tab) or a
 * `WebviewView` (Secondary Side Bar). The editor tab is authoritative:
 * `attachToSidebar` refuses to attach if the session is already live there,
 * so two controllers never race to patch it. State updates after the
 * initial render are pushed incrementally, never a full reload, so the
 * user's mid-typing or mid-review state is never blown away.
 */
export class ChatPanel {
  static readonly viewType = "paymodCode.chatEditor";
  private static readonly instances = new Map<string, ChatPanel>();
  private static readonly attachEmitter = new vscode.EventEmitter<string>();
  /** fires a session id whenever that session's controller attaches to an editor-tab panel - including a reparent away from the sidebar. */
  static readonly onDidAttachToEditor = ChatPanel.attachEmitter.event;

  private webview: vscode.Webview | undefined;
  private panel: vscode.WebviewPanel | undefined;
  private webviewDisposables: vscode.Disposable[] = [];
  private readonly lifecycleDisposables: vscode.Disposable[] = [];
  private readonly host: VSCodeHost;
  private readonly byokStore: ByokKeyStore;
  private readonly balanceState: BalanceState;
  private running = false;
  private abortController: AbortController | undefined;
  private pendingDiffResolve: ((result: DiffReviewResult) => void) | undefined;
  private turnUsage: ModelUsage | undefined;

  static isLiveInEditor(sessionId: string): boolean {
    return ChatPanel.instances.get(sessionId)?.panel !== undefined;
  }

  static createOrShow(
    authState: AuthState,
    registry: SessionRegistry,
    deps: AgentDependencies,
    extensionUri: vscode.Uri,
    sessionId: string,
    title: string,
  ): void {
    const existing = ChatPanel.instances.get(sessionId);
    if (existing?.panel) {
      existing.panel.reveal(vscode.ViewColumn.Active);
      return;
    }

    const panel = vscode.window.createWebviewPanel(ChatPanel.viewType, title, vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });
    // A fixed-color variant, not the theme-recolored `icon.svg` the
    // activity bar uses - a tab icon isn't tinted by VS Code the way a
    // `currentColor`-filled activity-bar icon is, so that file renders
    // flat black here instead of picking up any color at all.
    panel.iconPath = vscode.Uri.joinPath(extensionUri, "media", "icon-tab.svg");

    const instance = existing ?? new ChatPanel(sessionId, authState, registry, deps, extensionUri);
    ChatPanel.instances.set(sessionId, instance);
    instance.panel = panel;
    instance.attachWebview(panel.webview, extensionUri);
    panel.onDidDispose(() => instance.disposePanel(), undefined, instance.lifecycleDisposables);
    ChatPanel.attachEmitter.fire(sessionId);
  }

  /**
   * reuses the same live controller a session already has instead of
   * constructing a second one that would race an editor tab's agent loop.
   * Returns the instance either way so `ChatSidebarViewProvider` can check
   * `isLiveInEditor` and render its own redirect state.
   */
  static attachToSidebar(
    authState: AuthState,
    registry: SessionRegistry,
    deps: AgentDependencies,
    extensionUri: vscode.Uri,
    sessionId: string,
    webview: vscode.Webview,
  ): ChatPanel {
    const existing = ChatPanel.instances.get(sessionId);
    if (existing?.panel) return existing;

    const instance = existing ?? new ChatPanel(sessionId, authState, registry, deps, extensionUri);
    ChatPanel.instances.set(sessionId, instance);
    instance.attachWebview(webview, extensionUri);
    return instance;
  }

  /** detaches (not disposes) a sidebar-hosted controller - the user switched the sidebar to a different session, not closed anything. The controller, its host and any in-flight turn stay alive; it just stops posting to a webview nobody's looking at until reattached. */
  static detachFromSidebar(sessionId: string): void {
    const existing = ChatPanel.instances.get(sessionId);
    if (existing && !existing.panel) existing.detachWebview();
  }

  /** resolves the pending diff decision for one session from outside the webview - the diff editor's own title-bar Accept/Reject buttons (`paymodCode.acceptDiff`/`rejectDiff`, registered in extension.ts) call this instead of requiring the user to switch back to the chat tab. */
  static resolveDiffFromEditor(sessionId: string, decision: "accept" | "reject"): void {
    ChatPanel.instances.get(sessionId)?.resolveDiffDecision(decision);
  }

  /** called after `paymodCode.setByokKey`/`clearByokKey` so a chat tab already open doesn't keep showing stale "sign in first" state until it's reopened. */
  static refreshAllSessionStates(): void {
    for (const instance of ChatPanel.instances.values()) void instance.postSessionState();
  }

  private constructor(
    private readonly sessionId: string,
    private readonly authState: AuthState,
    private readonly registry: SessionRegistry,
    deps: AgentDependencies,
    _extensionUri: vscode.Uri,
  ) {
    this.byokStore = deps.byokStore;
    this.balanceState = deps.balanceState;
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    this.host = new VSCodeHost(
      workspaceRoot,
      this.sessionId,
      deps.credentials,
      deps.diffProvider,
      deps.sessionsDir,
      deps.artifactsDir,
      deps.compactionRecordsDir,
      (event) => this.handleAgentEvent(event),
      (edits) => this.requestDiffDecision(edits),
      () => this.registry.get(this.sessionId)?.autoApprovedTools ?? [],
    );
    this.authState.onDidChange(() => void this.postSessionState(), undefined, this.lifecycleDisposables);
  }

  /** (Re)binds this controller to a webview, tearing down any previous binding's message listener first - safe to call repeatedly, including with the same webview a sidebar re-render might pass again. */
  private attachWebview(webview: vscode.Webview, extensionUri: vscode.Uri): void {
    if (this.webview === webview) return;
    this.detachWebview();
    this.webview = webview;

    void renderReactWebviewHtml(webview, extensionUri).then((html) => {
      if (this.webview === webview) webview.html = html;
    });

    const listener = webview.onDidReceiveMessage((message: WebviewToExtensionMessage) => {
      if (message.type === "ready") void this.postSessionState();
      else if (message.type === "selectModel") void this.selectModel(message.modelId);
      else if (message.type === "setMode") void this.setMode(message.mode);
      else if (message.type === "submit") void this.submit(message.text);
      else if (message.type === "cancel") this.abortController?.abort();
      else if (message.type === "diffDecision") this.resolveDiffDecision(message.decision);
      else if (message.type === "contextSearch") void this.contextSearch(message.category, message.query, message.requestId);
      else if (message.type === "attachFiles") void this.attachFiles();
      else if (message.type === "toggleRuleFile") void this.toggleRuleFile(message.path, message.enabled);
      else if (message.type === "toggleAutoApprove") void this.toggleAutoApprove(message.toolName, message.enabled);
      else if (message.type === "openFile") void this.openFile(message.path, message.range);
      else if (message.type === "openDiff") void this.openDiff(message.path);
    });
    this.webviewDisposables.push(listener);
  }

  private detachWebview(): void {
    this.webview = undefined;
    for (const disposable of this.webviewDisposables.splice(0)) disposable.dispose();
  }

  /** A real close, not a detach - closing the editor tab ends this controller entirely (matches how it's always worked; an in-flight turn is left running to completion in the background, same as before, just with nothing posting its results anywhere). */
  private disposePanel(): void {
    ChatPanel.instances.delete(this.sessionId);
    this.panel = undefined;
    this.detachWebview();
    for (const disposable of this.lifecycleDisposables.splice(0)) disposable.dispose();
  }

  private post(message: ExtensionToWebviewMessage): void {
    void this.webview?.postMessage(message);
  }

  private async postSessionState(): Promise<void> {
    const session = this.registry.get(this.sessionId);
    const ruleFiles = await discoverRuleFiles(this.host.workspaceRoot, session?.disabledRuleFiles ?? []);
    const autoApproved = new Set(session?.autoApprovedTools ?? []);
    const configurableTools: ConfigurableTool[] = getConfigurableTools().map((tool) => ({ ...tool, autoApproved: autoApproved.has(tool.name) }));
    const [openaiKey, anthropicKey] = await Promise.all([this.byokStore.get("openai"), this.byokStore.get("anthropic")]);
    const byokProviders: ("openai" | "anthropic")[] = [...(openaiKey ? (["openai"] as const) : []), ...(anthropicKey ? (["anthropic"] as const) : [])];
    this.post({
      type: "sessionState",
      signedIn: this.authState.isSignedIn(),
      modelId: session?.modelId ?? "",
      mode: session?.mode ?? "act",
      ruleFiles,
      configurableTools,
      byokProviders,
      usage: session?.usage ?? { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
      contextUsage: session?.contextUsage,
      messages: session?.transcript.map((entry) => entry.message) ?? [],
    });
  }

  /** backs the composer's "@" mention menu across every category - the webview can't call `vscode.workspace`/`vscode.languages`/`git` itself, so it asks the extension host and gets a plain string list back. */
  private async contextSearch(category: ContextMentionCategory, query: string, requestId: number): Promise<void> {
    let results: string[] = [];
    try {
      if (category === "file") results = await this.searchFiles(query);
      else if (category === "folder") results = await this.searchFolders(query);
      else if (category === "problem") results = this.searchProblems(query);
      else if (category === "gitCommit") results = await this.searchGitCommits(query);
    } catch {
      results = [];
    }
    this.post({ type: "contextSearchResults", requestId, results });
  }

  private async searchFiles(query: string): Promise<string[]> {
    const pattern = query.trim() ? `**/*${query.trim()}*` : "**/*";
    const uris = await vscode.workspace.findFiles(pattern, FIND_FILES_EXCLUDE, 20);
    return uris.map((uri) => vscode.workspace.asRelativePath(uri, false));
  }

  private async searchFolders(query: string): Promise<string[]> {
    const uris = await vscode.workspace.findFiles("**/*", FIND_FILES_EXCLUDE, 500);
    const dirs = new Set<string>();
    for (const uri of uris) {
      const parts = vscode.workspace.asRelativePath(uri, false).split("/");
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
    }
    const needle = query.trim().toLowerCase();
    const sorted = [...dirs].sort();
    return (needle ? sorted.filter((dir) => dir.toLowerCase().includes(needle)) : sorted).slice(0, 20);
  }

  private searchProblems(query: string): string[] {
    const items: string[] = [];
    for (const [uri, diagnostics] of vscode.languages.getDiagnostics()) {
      const rel = vscode.workspace.asRelativePath(uri, false);
      for (const diagnostic of diagnostics) items.push(`${rel}:${diagnostic.range.start.line + 1}: ${diagnostic.message}`);
    }
    const needle = query.trim().toLowerCase();
    return (needle ? items.filter((item) => item.toLowerCase().includes(needle)) : items).slice(0, 20);
  }

  private async searchGitCommits(query: string): Promise<string[]> {
    try {
      const { stdout } = await execFileAsync("git", ["log", "--oneline", "-50"], { cwd: this.host.workspaceRoot });
      const lines = stdout.split("\n").filter(Boolean);
      const needle = query.trim().toLowerCase();
      return (needle ? lines.filter((line) => line.toLowerCase().includes(needle)) : lines).slice(0, 20);
    } catch {
      return [];
    }
  }

  /** backs the composer's "Add Files & Images" button - opens VS Code's real native picker and hands the chosen paths back for insertion as mentions (there is no vision-capable model wired in yet, so an attachment is a path reference, not image bytes). */
  private async attachFiles(): Promise<void> {
    const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: true,
      openLabel: "Attach",
      ...(workspaceUri && { defaultUri: workspaceUri }),
    });
    const paths = (uris ?? []).map((uri) => vscode.workspace.asRelativePath(uri, false));
    this.post({ type: "attachFilesResult", paths });
  }

  /** opens a real file from a clickable reference in the tool-activity feed, revealing and selecting the given range if one is given - a read has no range (Paymod's `read_file` always reads the whole file), an edit's range is the outer bound of what actually changed. */
  private async openFile(filePath: string, range: { start: number; end: number } | undefined): Promise<void> {
    const uri = vscode.Uri.file(path.join(this.host.workspaceRoot, filePath));
    const editor = await vscode.window.showTextDocument(uri, { preview: true });
    if (!range) return;
    const startLine = Math.max(0, range.start - 1);
    const endLine = Math.max(startLine, range.end - 1);
    const selection = new vscode.Selection(startLine, 0, endLine, editor.document.lineAt(endLine).text.length);
    editor.selection = selection;
    editor.revealRange(selection, vscode.TextEditorRevealType.InCenter);
  }

  /** the diff card's own "open in editor" button - `VSCodeHost.reviewDiff` never opens a diff tab on its own, so this is the only place a real diff editor appears, and only because the user asked for it. */
  private async openDiff(filePath: string): Promise<void> {
    const { originalUri, proposedUri } = diffUrisFor(this.sessionId, filePath);
    await vscode.commands.executeCommand("vscode.diff", originalUri, proposedUri, `Review: ${filePath}`, { preview: false });
  }

  private async toggleRuleFile(filePath: string, enabled: boolean): Promise<void> {
    const session = this.registry.get(this.sessionId);
    if (!session) return;
    const disabled = new Set(session.disabledRuleFiles ?? []);
    if (enabled) disabled.delete(filePath);
    else disabled.add(filePath);
    await this.registry.patch(this.sessionId, { disabledRuleFiles: [...disabled] });
    await this.postSessionState();
  }

  private async setMode(mode: "plan" | "act"): Promise<void> {
    await this.registry.patch(this.sessionId, { mode });
  }

  private async toggleAutoApprove(toolName: string, enabled: boolean): Promise<void> {
    const session = this.registry.get(this.sessionId);
    if (!session) return;
    const autoApproved = new Set(session.autoApprovedTools ?? []);
    if (enabled) autoApproved.add(toolName);
    else autoApproved.delete(toolName);
    await this.registry.patch(this.sessionId, { autoApprovedTools: [...autoApproved] });
    await this.postSessionState();
  }

  private async selectModel(modelId: string): Promise<void> {
    await this.registry.patch(this.sessionId, { modelId });
  }

  private async submit(text: string): Promise<void> {
    if (this.running) return;

    const session = this.registry.get(this.sessionId);
    if (!session) return;

    // BYOK bypasses Paymod entirely for this model's provider - no sign-in
    // needed, no Paymod balance touched (PAYMOD_CODE_PLAN.md section 3).
    // Only fall back to requiring a signed-in Paymod session when no key is
    // configured for the model actually selected.
    const descriptor = getModelDescriptor(session.modelId);
    const byokKey = descriptor ? await this.byokStore.get(descriptor.provider) : undefined;
    if (!byokKey && !this.authState.isSignedIn()) {
      this.post({ type: "error", text: 'Sign in first, or add your own API key (Command Palette: "Paymod Code: Set My API Key").' });
      return;
    }

    // names the session from its first message, the way Claude Code and
    // Cursor do - only when it's still carrying the untouched default and
    // has never had a message, so a session the user already renamed by
    // hand is never silently overwritten.
    if (session.transcript.length === 0 && session.title === DEFAULT_SESSION_TITLE) {
      await this.registry.rename(this.sessionId, titleFromPrompt(text));
    }

    this.running = true;
    this.abortController = new AbortController();
    this.turnUsage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
    let turnContextUsage: ContextUsage | undefined;
    try {
      const apiKey = byokKey ?? (await this.authState.getCredential());
      if (!apiKey) throw new Error("No stored credential. Sign in again.");
      const provider = buildProvider(session.modelId, apiKey, Boolean(byokKey));

      const ruleFiles = await discoverRuleFiles(this.host.workspaceRoot, session.disabledRuleFiles ?? []);
      const rulesText = await readEnabledRuleFilesText(this.host.workspaceRoot, ruleFiles);

      const result = await runSessionTurn({
        host: this.host,
        provider,
        model: session.modelId,
        sessionId: this.sessionId,
        systemPrompt: systemPrompt(this.host.workspaceRoot, session.mode ?? "act", rulesText),
        session: { transcript: session.transcript, activeCompaction: session.activeCompaction, originalTask: session.originalTask },
        userMessage: text,
        lastContextUsage: session.contextUsage,
        signal: this.abortController.signal,
      });
      turnContextUsage = result.contextUsage;

      // the system prompt is derived, not part of the persisted conversation.
      const priorUsage = this.registry.get(this.sessionId)?.usage ?? { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
      const usage = {
        inputTokens: priorUsage.inputTokens + this.turnUsage.inputTokens,
        outputTokens: priorUsage.outputTokens + this.turnUsage.outputTokens,
        cachedInputTokens: (priorUsage.cachedInputTokens ?? 0) + (this.turnUsage.cachedInputTokens ?? 0),
      };
      await this.registry.patch(this.sessionId, {
        transcript: result.transcript,
        activeCompaction: result.activeCompaction,
        originalTask: result.originalTask,
        usage,
        ...(result.contextUsage !== undefined && { contextUsage: result.contextUsage }),
      });
    } catch (error) {
      if (!this.abortController.signal.aborted) {
        this.post({ type: "error", text: error instanceof Error ? error.message : "Something went wrong." });
      }
    } finally {
      this.running = false;
      this.abortController = undefined;
      this.turnUsage = undefined;
      this.post({ type: "turnComplete", contextUsage: turnContextUsage });
      // A Paymod-managed turn just spent real balance - refresh rather than
      // wait for the next sign-in/visibility event to notice. A no-op fetch
      // for BYOK (nothing changed), but cheap enough not to bother telling
      // the two cases apart here.
      void this.balanceState.refresh();
    }
  }

  private handleAgentEvent(event: AgentEvent): void {
    if (event.type === "message_stop" && this.turnUsage) {
      this.turnUsage = {
        inputTokens: this.turnUsage.inputTokens + event.response.usage.inputTokens,
        outputTokens: this.turnUsage.outputTokens + event.response.usage.outputTokens,
        cachedInputTokens: (this.turnUsage.cachedInputTokens ?? 0) + (event.response.usage.cachedInputTokens ?? 0),
      };
    }
    this.post({ type: "agentEvent", event });
  }

  /** resolved by `resolveDiffDecision` once the user clicks Accept/Reject on the inline card the webview renders for a `diffReady`-carrying `agentEvent`. */
  private requestDiffDecision(_edits: ProposedEdit[]): Promise<DiffReviewResult> {
    return new Promise((resolve) => {
      this.pendingDiffResolve = resolve;
    });
  }

  private resolveDiffDecision(decision: "accept" | "reject"): void {
    const resolve = this.pendingDiffResolve;
    if (!resolve) return;
    this.pendingDiffResolve = undefined;
    resolve(decision === "accept" ? { decision: "accept" } : { decision: "reject", reason: "The user rejected the changes shown in the diff review." });
  }
}
