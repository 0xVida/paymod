import * as vscode from "vscode";
import { AuthState } from "./auth/auth-state.js";
import { CredentialStore } from "./auth/credential-store.js";
import { ByokKeyStore, type InferenceProvider } from "./auth/byok-key-store.js";
import { BalanceState } from "./auth/balance-state.js";
import { SessionRegistry, SecondarySidebarState } from "./sessions/session-store.js";
import { SessionListProvider } from "./sidebar/session-list.js";
import { ChatSidebarViewProvider } from "./sidebar/chat-sidebar-view.js";
import { ChatPanel, type AgentDependencies } from "./sidebar/chat-panel.js";
import { DiffContentProvider, DIFF_SCHEME } from "./agent/diff-content-provider.js";
import type { Session } from "./sidebar/types.js";

const SECONDARY_SIDEBAR_TIP_SHOWN_KEY = "paymodCode.secondarySidebarTipShown";

const PROVIDER_PICK_ITEMS: { label: string; provider: InferenceProvider }[] = [
  { label: "OpenAI", provider: "openai" },
  { label: "Anthropic", provider: "anthropic" },
];

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const authState = new AuthState(context.secrets);
  await authState.initialize();

  const balanceState = new BalanceState(authState);
  void balanceState.refresh();
  authState.onDidChange(() => void balanceState.refresh());

  const sessionsDir = vscode.Uri.joinPath(context.globalStorageUri, "sessions").fsPath;
  const artifactsDir = vscode.Uri.joinPath(context.globalStorageUri, "artifacts").fsPath;
  const compactionRecordsDir = vscode.Uri.joinPath(context.globalStorageUri, "compactions").fsPath;
  const registry = new SessionRegistry(sessionsDir, artifactsDir, compactionRecordsDir);
  await registry.initialize();

  const secondarySidebarState = new SecondarySidebarState();

  const diffProvider = new DiffContentProvider();
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(DIFF_SCHEME, diffProvider));

  const byokStore = new ByokKeyStore(context.secrets);
  const agentDeps: AgentDependencies = {
    credentials: new CredentialStore(context.secrets),
    byokStore,
    diffProvider,
    sessionsDir,
    artifactsDir,
    compactionRecordsDir,
    balanceState,
  };

  function openInEditor(session: Session): void {
    ChatPanel.createOrShow(authState, registry, agentDeps, context.extensionUri, session.id, session.title);
  }

  // reads the session id embedded in the active diff editor's virtual URI
  // (`VSCodeHost.reviewDiff` sets it) so the diff editor's own title-bar
  // Accept/Reject buttons resolve the right session's pending decision
  // without ever needing focus back on the chat tab.
  function resolveActiveDiff(decision: "accept" | "reject"): void {
    const uri = vscode.window.activeTextEditor?.document.uri;
    if (!uri || uri.scheme !== DIFF_SCHEME) return;
    const sessionId = new URLSearchParams(uri.query).get("session");
    if (sessionId) ChatPanel.resolveDiffFromEditor(sessionId, decision);
  }

  async function openInSecondarySideBar(session: Session): Promise<void> {
    const stored = registry.get(session.id);
    if (!stored) return;
    secondarySidebarState.set(stored);
    // no stable VS Code API lets an extension default a view into the
    // Secondary Side Bar (see the plan doc's bug log). This focuses
    // paymodCode.chatSidebar wherever it currently lives - only the
    // Secondary Side Bar after the user has dragged it there once.
    await vscode.commands.executeCommand("workbench.action.focusAuxiliaryBar");
    await vscode.commands.executeCommand("paymodCode.chatSidebar.focus");

    if (!context.globalState.get(SECONDARY_SIDEBAR_TIP_SHOWN_KEY)) {
      void context.globalState.update(SECONDARY_SIDEBAR_TIP_SHOWN_KEY, true);
      void vscode.window.showInformationMessage(
        "If the Paymod Code chat isn't docked on the right yet, drag its tab from the left sidebar into the Secondary Side Bar once. This action will target it there from then on.",
      );
    }
  }

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SessionListProvider.viewId, new SessionListProvider(registry, authState, balanceState)),
    vscode.window.registerWebviewViewProvider(
      ChatSidebarViewProvider.viewId,
      new ChatSidebarViewProvider(authState, secondarySidebarState, registry, agentDeps, context.extensionUri),
    ),

    vscode.commands.registerCommand("paymodCode.newSession", async () => {
      const session = await registry.create();
      openInEditor(session);
    }),

    vscode.commands.registerCommand("paymodCode.openSessionInEditor", (sessionId: string) => {
      const session = registry.get(sessionId);
      if (session) openInEditor(session);
    }),

    vscode.commands.registerCommand("paymodCode.openSessionInSecondarySideBar", (sessionId: string) => {
      const session = registry.get(sessionId);
      if (session) void openInSecondarySideBar(session);
    }),

    vscode.commands.registerCommand("paymodCode.focusSessions", () => {
      void vscode.commands.executeCommand("paymodCode.sessions.focus");
    }),

    // `title` comes from the session list's own inline rename input when
    // present - only the command-palette invocation (no argument) falls
    // back to a native prompt, since there's no in-webview surface asking
    // for one there.
    vscode.commands.registerCommand("paymodCode.renameSession", async (sessionId: string, title?: string) => {
      const session = registry.get(sessionId);
      if (!session) return;
      const nextTitle = title ?? (await vscode.window.showInputBox({ prompt: "Rename session", value: session.title }));
      if (nextTitle) await registry.rename(sessionId, nextTitle);
    }),

    // `skipConfirm` comes from the session list's own inline delete
    // confirmation - only the command-palette invocation falls back to a
    // native confirm dialog.
    vscode.commands.registerCommand("paymodCode.deleteSession", async (sessionId: string, options?: { skipConfirm?: boolean }) => {
      const session = registry.get(sessionId);
      if (!session) return;
      if (options?.skipConfirm) {
        await registry.remove(sessionId);
        return;
      }
      const confirm = await vscode.window.showWarningMessage(`Delete "${session.title}"?`, { modal: true }, "Delete");
      if (confirm === "Delete") await registry.remove(sessionId);
    }),

    vscode.commands.registerCommand("paymodCode.acceptDiff", () => resolveActiveDiff("accept")),
    vscode.commands.registerCommand("paymodCode.rejectDiff", () => resolveActiveDiff("reject")),

    // BYOK: a stored key bypasses Paymod entirely for that model's provider
    // (PAYMOD_CODE_PLAN.md section 3). A native input box, not a webview
    // form: the key must never pass through session JSON, logs or
    // `settings.json`.
    vscode.commands.registerCommand("paymodCode.setByokKey", async () => {
      const picked = await vscode.window.showQuickPick(
        PROVIDER_PICK_ITEMS.map((item) => ({ label: item.label, provider: item.provider })),
        { placeHolder: "Which provider is this key for?" },
      );
      if (!picked) return;
      const key = await vscode.window.showInputBox({
        prompt: `Paste your ${picked.label} API key`,
        password: true,
        ignoreFocusOut: true,
      });
      if (!key) return;
      await byokStore.set(picked.provider, key);
      ChatPanel.refreshAllSessionStates();
      void vscode.window.showInformationMessage(
        `${picked.label} key saved. ${picked.label} models now run on this key instead of your Paymod balance.`,
      );
    }),

    vscode.commands.registerCommand("paymodCode.clearByokKey", async () => {
      const picked = await vscode.window.showQuickPick(
        PROVIDER_PICK_ITEMS.map((item) => ({ label: item.label, provider: item.provider })),
        { placeHolder: "Remove which provider's key?" },
      );
      if (!picked) return;
      await byokStore.clear(picked.provider);
      ChatPanel.refreshAllSessionStates();
      void vscode.window.showInformationMessage(`${picked.label} key removed.`);
    }),
  );
}

export function deactivate(): void {}
