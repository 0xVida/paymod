import * as vscode from "vscode";
import type { AuthState } from "../auth/auth-state.js";
import type { SecondarySidebarState, SessionRegistry } from "../sessions/session-store.js";
import { ChatPanel, type AgentDependencies } from "./chat-panel.js";
import { renderWebviewDocument } from "./webview-html.js";

/**
 * the Secondary Side Bar's own view onto `ChatPanel` - the same live
 * controller and React UI, not a separate read-only renderer. VS Code has
 * no stable API to default a view into the Secondary Side Bar on first
 * install, so the user drags this view there once and
 * `paymodCode.openSessionInSecondarySideBar` targets it from then on.
 *
 * The editor tab is authoritative: if the targeted session is already open
 * there, this shows a redirect state instead of attaching, so two
 * controllers never race to patch the same session.
 * `ChatPanel.onDidAttachToEditor` is how this drops back to the redirect
 * state when that happens.
 */
export class ChatSidebarViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = "paymodCode.chatSidebar";

  constructor(
    private readonly authState: AuthState,
    private readonly sidebarState: SecondarySidebarState,
    private readonly registry: SessionRegistry,
    private readonly deps: AgentDependencies,
    private readonly extensionUri: vscode.Uri,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = { enableScripts: true };
    let attachedSessionId: string | undefined;

    const render = () => {
      const current = this.sidebarState.get();
      // re-read from the registry, not the possibly-stale object `sidebarState` was set with.
      const session = current && this.registry.get(current.id);

      if (attachedSessionId && attachedSessionId !== session?.id) {
        ChatPanel.detachFromSidebar(attachedSessionId);
        attachedSessionId = undefined;
      }

      if (!session) {
        webviewView.webview.html = renderNoSessionState(webviewView.webview);
        return;
      }

      if (ChatPanel.isLiveInEditor(session.id)) {
        webviewView.webview.html = renderOpenInEditorState(webviewView.webview, session.id, session.title);
        return;
      }

      // idempotent against repeat calls with the same webview (a running
      // turn's own registry patches re-trigger `render()` constantly) -
      // `ChatPanel.attachWebview` no-ops if already attached to this exact
      // webview, so this doesn't reset state or flicker mid-turn.
      ChatPanel.attachToSidebar(this.authState, this.registry, this.deps, this.extensionUri, session.id, webviewView.webview);
      attachedSessionId = session.id;
    };
    render();

    webviewView.webview.onDidReceiveMessage((message: { type: string; sessionId?: string }) => {
      if (message.type === "openInEditor" && message.sessionId) {
        void vscode.commands.executeCommand("paymodCode.openSessionInEditor", message.sessionId);
      }
    });

    const authSubscription = this.authState.onDidChange(render);
    const sessionSubscription = this.sidebarState.onDidChange(render);
    const registrySubscription = this.registry.onDidChange(render);
    const attachSubscription = ChatPanel.onDidAttachToEditor((sessionId) => {
      if (sessionId === attachedSessionId) render();
    });
    webviewView.onDidDispose(() => {
      if (attachedSessionId) ChatPanel.detachFromSidebar(attachedSessionId);
      authSubscription.dispose();
      sessionSubscription.dispose();
      registrySubscription.dispose();
      attachSubscription.dispose();
    });
  }
}

function renderNoSessionState(webview: vscode.Webview): string {
  const body = `<div class="empty">No session open here yet.<br />Use a session's "Open in Secondary Side Bar" action.</div>`;
  return renderWebviewDocument(webview, body, "");
}

function renderOpenInEditorState(webview: vscode.Webview, sessionId: string, title: string): string {
  const body = `
    <div class="empty" style="flex-direction: column; gap: 10px;">
      <div>"${escapeHtml(title)}" is open in the editor tab.</div>
      <button id="reveal">Reveal it there</button>
    </div>
  `;
  const script = `
    const vscode = acquireVsCodeApi();
    document.getElementById("reveal")?.addEventListener("click", () => {
      vscode.postMessage({ type: "openInEditor", sessionId: ${JSON.stringify(sessionId)} });
    });
  `;
  return renderWebviewDocument(webview, body, script);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
