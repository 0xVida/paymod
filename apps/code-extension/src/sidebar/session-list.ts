import * as vscode from "vscode";
import type { SessionRegistry } from "../sessions/session-store.js";
import type { AuthState } from "../auth/auth-state.js";
import type { BalanceState } from "../auth/balance-state.js";
import { renderWebviewDocument } from "./webview-html.js";
import { formatRelativeTime } from "@paymod/code-core";
import type { Session } from "./types.js";

/**
 * the activity-bar icon's target: a session list, not the conversation
 * itself, matching Claude Code's split between a session picker and an
 * editor-hosted conversation. Rename and delete happen inline in the row,
 * not via `showInputBox`/`showWarningMessage`, so nothing here pops an
 * OS-chrome dialog.
 */
export class SessionListProvider implements vscode.WebviewViewProvider {
  static readonly viewId = "paymodCode.sessions";

  constructor(
    private readonly registry: SessionRegistry,
    private readonly authState: AuthState,
    private readonly balanceState: BalanceState,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = { enableScripts: true };

    const render = () => {
      webviewView.webview.html = renderSessionListHtml(webviewView.webview, this.registry.list(), this.authState.isSignedIn(), this.balanceState.get());
    };
    render();

    // not a poll - just a check whenever the user switches back to this
    // view, so a deposit made on the dashboard in another tab shows up
    // without needing a reload.
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) void this.balanceState.refresh();
    });

    webviewView.webview.onDidReceiveMessage((message: { type: string; sessionId?: string; sessionIds?: string[]; title?: string; favorite?: boolean }) => {
      if (message.type === "newSession") void vscode.commands.executeCommand("paymodCode.newSession");
      if (message.type === "openInEditor" && message.sessionId) {
        void vscode.commands.executeCommand("paymodCode.openSessionInEditor", message.sessionId);
      }
      if (message.type === "openInSecondarySideBar" && message.sessionId) {
        void vscode.commands.executeCommand("paymodCode.openSessionInSecondarySideBar", message.sessionId);
      }
      if (message.type === "renameSession" && message.sessionId && message.title) {
        void vscode.commands.executeCommand("paymodCode.renameSession", message.sessionId, message.title);
      }
      if (message.type === "deleteSession" && message.sessionId) {
        void vscode.commands.executeCommand("paymodCode.deleteSession", message.sessionId, { skipConfirm: true });
      }
      if (message.type === "toggleFavorite" && message.sessionId) {
        void this.registry.patch(message.sessionId, { favorite: message.favorite ?? false }, { touchLastActivity: false });
      }
      if (message.type === "deleteSessions" && message.sessionIds?.length) {
        void this.registry.removeMany(message.sessionIds);
      }
      if (message.type === "signIn") void this.authState.signIn();
      if (message.type === "signOut") this.authState.signOut();
    });

    const registrySubscription = this.registry.onDidChange(render);
    const authSubscription = this.authState.onDidChange(render);
    const balanceSubscription = this.balanceState.onDidChange(render);
    webviewView.onDidDispose(() => {
      registrySubscription.dispose();
      authSubscription.dispose();
      balanceSubscription.dispose();
    });
  }
}

// inline SVG rather than an icon font: the webview's CSP has no font-src, so
// a bundled codicon font would need CSP surgery just to draw four icons.
const ICON_PLUS = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
const ICON_SEARCH = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.3"/><path d="M11 11l3.5 3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`;
const ICON_MORE = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="3.5" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="8" cy="12.5" r="1.3"/></svg>`;
const ICON_ACCOUNT = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5.5" r="3" stroke="currentColor" stroke-width="1.3"/><path d="M2.5 14c0-3 2.5-5 5.5-5s5.5 2 5.5 5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`;
const STAR_PATH = "M8 1.5l1.9 4.2 4.6.5-3.4 3.1.9 4.6L8 11.7l-4 2.2.9-4.6-3.4-3.1 4.6-.5L8 1.5z";
const ICON_STAR = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.1"><path d="${STAR_PATH}"/></svg>`;
const ICON_STAR_FILLED = `<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="${STAR_PATH}"/></svg>`;

/** real balance from `GET /v1/code/wallet/balance` (PAYMOD_CODE_PLAN.md section 2) - `undefined` while the first fetch is still in flight, not a fake number. */
function formatBalance(balanceUsd: number | undefined): string {
  return balanceUsd === undefined ? "Loading balance..." : `$${balanceUsd.toFixed(2)}`;
}

function renderSessionListHtml(webview: vscode.Webview, sessions: readonly Session[], signedIn: boolean, balanceUsd: number | undefined): string {
  const rows = sessions.length
    ? sessions.map(renderSessionRow).join("")
    : `<div class="empty">No sessions yet. Click "New session" to start.</div>`;

  const body = `
    <div class="session-list-header">
      <button id="new-session" class="new-session-btn">${ICON_PLUS}<span>New session</span></button>
      <div class="session-search">
        ${ICON_SEARCH}
        <input id="search" placeholder="Search sessions..." />
      </div>
      <div class="session-list-toolbar">
        <select id="sort" title="Sort sessions">
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="tokens">Most tokens</option>
        </select>
        <div class="row" style="gap: 2px;">
          <button id="favorites-toggle" class="icon-btn" title="Favorites only" aria-label="Favorites only">${ICON_STAR}</button>
          <button id="select-toggle" class="icon-btn" title="Select sessions" aria-label="Select sessions">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.3"/><path d="M5 8l2 2 4-4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </div>
      <div class="session-select-bar" id="select-bar" hidden>
        <span id="select-count">0 selected</span>
        <div class="row">
          <button id="select-cancel" class="secondary">Cancel</button>
          <button id="select-delete">Delete</button>
        </div>
      </div>
    </div>
    <div class="section-label">Sessions</div>
    <div class="session-list-body" id="sessions">${rows}</div>
    <div class="session-list-footer">
      <div class="section-label">Account</div>
      <div class="account-row">
        <div class="account-info">
          ${ICON_ACCOUNT}
          <div class="account-text">
            <div class="account-status">${signedIn ? "Signed in" : "Not signed in"}</div>
            ${signedIn ? `<div class="account-balance">${escapeHtml(formatBalance(balanceUsd))}</div>` : ""}
          </div>
        </div>
        <button id="account-btn" class="secondary">${signedIn ? "Sign out" : "Sign in"}</button>
      </div>
    </div>
  `;

  const script = `
    const vscode = acquireVsCodeApi();
    document.getElementById("new-session")?.addEventListener("click", () => vscode.postMessage({ type: "newSession" }));
    document.getElementById("account-btn")?.addEventListener("click", () => vscode.postMessage({ type: ${JSON.stringify(signedIn ? "signOut" : "signIn")} }));

    // sort/favorites-only preferences are UI-only and would otherwise reset
    // every time the registry changes and this document re-renders (which
    // happens on every favorite toggle) - vscode.getState/setState persists
    // them across that without any extension involvement.
    const uiState = vscode.getState() || { sort: "newest", favoritesOnly: false };
    document.getElementById("sort").value = uiState.sort;
    document.getElementById("favorites-toggle").classList.toggle("active", uiState.favoritesOnly);

    let selectMode = false;
    const selected = new Set();

    function applyFilterAndSort() {
      const query = (document.getElementById("search")?.value || "").toLowerCase();
      const favoritesOnly = document.getElementById("favorites-toggle").classList.contains("active");
      const sort = document.getElementById("sort").value;
      const container = document.getElementById("sessions");
      const rows = Array.from(container.querySelectorAll("[data-session-id]"));

      rows.forEach((row) => {
        const matchesQuery = row.dataset.title.toLowerCase().includes(query);
        const matchesFavorite = !favoritesOnly || row.dataset.favorite === "1";
        row.style.display = matchesQuery && matchesFavorite ? "" : "none";
      });

      const sorted = rows.slice().sort((a, b) => {
        if (sort === "tokens") return Number(b.dataset.tokens) - Number(a.dataset.tokens);
        if (sort === "oldest") return a.dataset.lastActivity.localeCompare(b.dataset.lastActivity);
        return b.dataset.lastActivity.localeCompare(a.dataset.lastActivity);
      });
      sorted.forEach((row) => container.appendChild(row));

      vscode.setState({ sort, favoritesOnly });
    }
    applyFilterAndSort();

    document.getElementById("sort").addEventListener("change", applyFilterAndSort);
    document.getElementById("favorites-toggle").addEventListener("click", (event) => {
      event.currentTarget.classList.toggle("active");
      applyFilterAndSort();
    });
    document.getElementById("search")?.addEventListener("input", applyFilterAndSort);

    function updateSelectBar() {
      document.getElementById("select-count").textContent = selected.size + " selected";
      document.getElementById("select-delete").disabled = selected.size === 0;
    }
    document.getElementById("select-toggle").addEventListener("click", () => {
      selectMode = true;
      selected.clear();
      document.body.classList.add("select-mode");
      document.getElementById("select-bar").hidden = false;
      document.querySelectorAll("[data-session-id]").forEach((row) => row.querySelector(".session-row-checkbox").checked = false);
      updateSelectBar();
    });
    document.getElementById("select-cancel").addEventListener("click", () => {
      selectMode = false;
      selected.clear();
      document.body.classList.remove("select-mode");
      document.getElementById("select-bar").hidden = true;
    });
    document.getElementById("select-delete").addEventListener("click", () => {
      if (selected.size === 0) return;
      vscode.postMessage({ type: "deleteSessions", sessionIds: Array.from(selected) });
      selectMode = false;
      selected.clear();
      document.body.classList.remove("select-mode");
      document.getElementById("select-bar").hidden = true;
    });

    let openMenu = null;
    function closeMenu() {
      if (!openMenu) return;
      openMenu.menuEl.remove();
      openMenu.buttonEl.classList.remove("active");
      openMenu = null;
    }
    document.addEventListener("click", (event) => {
      // event.target is often the SVG icon inside the button, not the
      // button itself - contains() catches that, a strict !== check doesn't,
      // which was closing the menu in the same click that just opened it.
      if (openMenu && !openMenu.menuEl.contains(event.target) && !openMenu.buttonEl.contains(event.target)) closeMenu();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeMenu();
    });

    function defaultActionsHtml(favorite) {
      const starIcon = favorite ? ${JSON.stringify(ICON_STAR_FILLED)} : ${JSON.stringify(ICON_STAR)};
      const starTitle = favorite ? "Remove from favorites" : "Add to favorites";
      return '<button class="icon-btn star-btn" data-action="favorite" title="' + starTitle + '">' + starIcon + '</button>' +
        '<button class="icon-btn" data-action="more" title="More actions">' + ${JSON.stringify(ICON_MORE)} + '</button>';
    }

    function startRename(row) {
      const sessionId = row.dataset.sessionId;
      const titleEl = row.querySelector(".session-row-title");
      const currentTitle = row.dataset.title;
      const input = document.createElement("input");
      input.className = "session-row-title-input";
      input.value = currentTitle;
      titleEl.replaceWith(input);
      input.focus();
      input.select();
      function commit() {
        const nextTitle = input.value.trim();
        if (nextTitle && nextTitle !== currentTitle) {
          row.dataset.title = nextTitle;
          titleEl.textContent = nextTitle;
          vscode.postMessage({ type: "renameSession", sessionId, title: nextTitle });
        }
        input.replaceWith(titleEl);
      }
      input.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.key === "Enter") { event.preventDefault(); input.blur(); }
        if (event.key === "Escape") { event.preventDefault(); input.value = currentTitle; input.blur(); }
      });
      input.addEventListener("blur", commit, { once: true });
      input.addEventListener("click", (event) => event.stopPropagation());
    }

    function startDeleteConfirm(row) {
      const sessionId = row.dataset.sessionId;
      const actions = row.querySelector(".session-row-actions");
      actions.innerHTML = ${JSON.stringify('<div class="session-delete-confirm"><span>Delete?</span><button class="secondary" data-confirm="cancel">Cancel</button><button data-confirm="delete">Delete</button></div>')};
      row.classList.add("confirming");
      actions.querySelector('[data-confirm="cancel"]').addEventListener("click", (event) => {
        event.stopPropagation();
        row.classList.remove("confirming");
        actions.innerHTML = defaultActionsHtml(row.dataset.favorite === "1");
      });
      actions.querySelector('[data-confirm="delete"]').addEventListener("click", (event) => {
        event.stopPropagation();
        vscode.postMessage({ type: "deleteSession", sessionId });
      });
    }

    function openSessionMenu(buttonEl, row) {
      closeMenu();
      const menuEl = document.createElement("div");
      menuEl.className = "session-menu";
      menuEl.innerHTML = ${JSON.stringify(`
        <div class="session-menu-item" data-menu="editor">Open in Editor</div>
        <div class="session-menu-item" data-menu="sidebar">Open in Secondary Side Bar</div>
        <div class="session-menu-sep"></div>
        <div class="session-menu-item" data-menu="rename">Rename</div>
        <div class="session-menu-item danger" data-menu="delete">Delete</div>
      `)};
      document.body.appendChild(menuEl);
      const buttonRect = buttonEl.getBoundingClientRect();
      const menuRect = menuEl.getBoundingClientRect();
      const left = Math.min(buttonRect.right - menuRect.width, window.innerWidth - menuRect.width - 4);
      menuEl.style.left = Math.max(4, left) + "px";
      menuEl.style.top = Math.min(buttonRect.bottom + 2, window.innerHeight - menuRect.height - 4) + "px";
      buttonEl.classList.add("active");
      openMenu = { menuEl, buttonEl };
      const sessionId = row.dataset.sessionId;
      menuEl.addEventListener("click", (event) => {
        const action = event.target.closest("[data-menu]")?.dataset.menu;
        closeMenu();
        if (action === "editor") vscode.postMessage({ type: "openInEditor", sessionId });
        if (action === "sidebar") vscode.postMessage({ type: "openInSecondarySideBar", sessionId });
        if (action === "rename") startRename(row);
        if (action === "delete") startDeleteConfirm(row);
      });
    }

    document.getElementById("sessions")?.addEventListener("click", (event) => {
      const target = event.target;
      if (target.closest(".session-row-title-input") || target.closest(".session-delete-confirm")) return;
      const row = target.closest("[data-session-id]");
      if (!row) return;
      const sessionId = row.dataset.sessionId;

      if (selectMode) {
        const checkbox = row.querySelector(".session-row-checkbox");
        if (target !== checkbox) checkbox.checked = !checkbox.checked;
        if (checkbox.checked) selected.add(sessionId); else selected.delete(sessionId);
        updateSelectBar();
        return;
      }

      if (target.closest('[data-action="favorite"]')) {
        const nextFavorite = row.dataset.favorite !== "1";
        row.dataset.favorite = nextFavorite ? "1" : "0";
        row.classList.toggle("favorited", nextFavorite);
        row.querySelector('[data-action="favorite"]').innerHTML = nextFavorite ? ${JSON.stringify(ICON_STAR_FILLED)} : ${JSON.stringify(ICON_STAR)};
        vscode.postMessage({ type: "toggleFavorite", sessionId, favorite: nextFavorite });
        return;
      }

      const actionButton = target.closest("[data-action]");
      const action = actionButton?.dataset.action;
      if (action === "more") { openSessionMenu(actionButton, row); return; }
      vscode.postMessage({ type: "openInEditor", sessionId });
    });
  `;

  return renderWebviewDocument(webview, body, script);
}

function renderSessionRow(session: Session): string {
  const totalTokens = (session.usage?.inputTokens ?? 0) + (session.usage?.outputTokens ?? 0);
  return `
    <div
      data-session-id="${session.id}"
      data-title="${escapeHtml(session.title)}"
      data-favorite="${session.favorite ? "1" : "0"}"
      data-tokens="${totalTokens}"
      data-last-activity="${escapeHtml(session.lastActivity)}"
      class="session-row${session.favorite ? " favorited" : ""}"
    >
      <input type="checkbox" class="session-row-checkbox" />
      <div class="session-row-main">
        <div class="session-row-title">${escapeHtml(session.title)}</div>
        <span class="session-row-meta" title="${escapeHtml(session.lastActivity)}">${escapeHtml(formatRelativeTime(session.lastActivity))}</span>
      </div>
      <div class="session-row-actions">
        <button class="icon-btn star-btn" data-action="favorite" title="${session.favorite ? "Remove from favorites" : "Add to favorites"}">
          ${session.favorite ? ICON_STAR_FILLED : ICON_STAR}
        </button>
        <button class="icon-btn" data-action="more" title="More actions">${ICON_MORE}</button>
      </div>
    </div>
  `;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
