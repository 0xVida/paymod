import type { Webview } from "vscode";

export function nonce(): string {
  let text = "";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}

/** shared document shell: VS Code theme CSS variables, a strict nonce-based CSP and a `<div id="root">` the caller fills in. */
export function renderWebviewDocument(webview: Webview, bodyHtml: string, scriptBody: string): string {
  const cspNonce = nonce();
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${cspNonce}';" />
<style>
  html, body { height: 100%; }
  body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    background-color: var(--vscode-sideBar-background);
    padding: 0;
    margin: 0;
    font-size: 13px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .row { display: flex; align-items: center; gap: 6px; }
  .header {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border));
  }
  .muted { color: var(--vscode-descriptionForeground); }
  /* Paymod's brand accent, not the button-background variable (blue in most
     VS Code themes) and not a plain theme-foreground/background inversion -
     primary actions read as Paymod's own color in every theme. */
  button {
    background-color: #b95115;
    color: #fff;
    border: none;
    padding: 4px 10px;
    border-radius: 2px;
    cursor: pointer;
    font-size: 12px;
  }
  button:hover { opacity: 0.85; }
  button.secondary {
    background-color: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  button.secondary:hover { background-color: var(--vscode-button-secondaryHoverBackground); opacity: 1; }
  select {
    background-color: var(--vscode-dropdown-background);
    color: var(--vscode-dropdown-foreground);
    border: 1px solid var(--vscode-dropdown-border);
    font-size: 12px;
    padding: 2px 4px;
  }
  /* without this, a clicked/focused <select> falls back to the browser's
     own default focus ring - a yellow halo that matches nothing in the
     theme - instead of a themed outline like every other focusable control. */
  select:focus {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
  }
  .composer {
    position: relative;
    flex: 0 0 auto;
    padding: 10px;
    border-top: 1px solid var(--vscode-panel-border);
  }
  .composer textarea {
    width: 100%;
    box-sizing: border-box;
    resize: none;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    border-radius: 8px;
    padding: 10px 12px;
    font-family: inherit;
    font-size: 13px;
    line-height: 1.4;
    max-height: 160px;
  }
  .composer textarea:focus {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
  }
  /* model, balance and sign-out sit below the input inside the composer
     itself (Claude Code's own bottom toolbar), not in a separate header
     bar at the top of the panel. */
  .composer-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 6px;
  }
  .composer-toolbar select {
    background: transparent;
    border-color: transparent;
    outline: none;
  }
  .mention-menu {
    position: absolute;
    left: 10px;
    right: 10px;
    bottom: 100%;
    margin-bottom: 4px;
    max-height: 180px;
    overflow-y: auto;
    background: var(--vscode-editorWidget-background, var(--vscode-input-background));
    border: 1px solid var(--vscode-panel-border);
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }
  .mention-item {
    padding: 6px 10px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px;
    cursor: pointer;
  }
  .mention-item-active, .mention-item:hover { background: var(--vscode-list-hoverBackground); }
  .body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 18px; }
  .empty { flex: 1 1 auto; display: flex; align-items: center; justify-content: center; }
  .empty { color: var(--vscode-descriptionForeground); padding: 16px 10px; text-align: center; }

  .session-list-header {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border));
  }
  .new-session-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    background: none;
    border: none;
    color: var(--vscode-foreground);
    padding: 5px 6px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    text-align: left;
  }
  .new-session-btn:hover { background: var(--vscode-list-hoverBackground); }
  .new-session-btn svg { flex-shrink: 0; color: var(--vscode-descriptionForeground); }
  .session-search { position: relative; display: flex; align-items: center; }
  .session-search svg {
    position: absolute;
    left: 10px;
    color: var(--vscode-descriptionForeground);
    pointer-events: none;
  }
  .session-search input {
    width: 100%;
    box-sizing: border-box;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    border-radius: 6px;
    padding: 7px 10px 7px 32px;
    font-size: 12px;
  }
  .session-search input::placeholder { color: var(--vscode-descriptionForeground); }
  .session-search input:focus {
    outline: 1px solid var(--vscode-foreground);
    outline-offset: -1px;
  }
  .session-list-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }
  .session-list-toolbar select {
    background: none;
    color: var(--vscode-descriptionForeground);
    border: none;
    font-size: 11px;
    padding: 2px 0;
  }
  .session-select-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding-top: 2px;
    font-size: 12px;
  }
  /* A class-based display rule beats the browser's own [hidden] default
     style, so [hidden] alone doesn't actually hide this without repeating
     the selector here. */
  .session-select-bar[hidden] { display: none; }
  .session-select-bar button { padding: 3px 8px; font-size: 11px; }
  /* A small uppercase label above each section (Sessions, Account) -
     standard sidebar convention for grouping otherwise-unlabeled content. */
  .section-label {
    flex: 0 0 auto;
    padding: 10px 10px 4px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--vscode-descriptionForeground);
  }
  .session-list-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    /* extra right padding (not just 4px like the other sides) keeps the
       row action buttons clear of the scrollbar's own hit area - without
       it, clicks on the right edge of the "..." button land on the
       scrollbar instead of the button. */
    padding: 0 12px 4px 4px;
    display: flex;
    flex-direction: column;
  }
  .session-list-footer {
    flex: 0 0 auto;
    padding-bottom: 6px;
    border-top: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border));
  }
  .account-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 2px 10px 4px;
  }
  /* the name/balance side truncates first at a narrow sidebar width - the
     button itself never shrinks or wraps away. */
  .account-row > button { flex-shrink: 0; }
  .account-info { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .account-info svg { flex-shrink: 0; color: var(--vscode-descriptionForeground); }
  .account-text { min-width: 0; }
  .account-status { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .account-balance { font-size: 11px; color: var(--vscode-descriptionForeground); }
  .session-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
    padding: 7px 8px;
    border-radius: 4px;
    cursor: pointer;
  }
  .session-row:hover { background: var(--vscode-list-hoverBackground); }
  /* flex-grow wasn't set, so with the star button now also in the row this
     was shrinking to its content width and sitting flush against the
     right edge (space-between) with a large empty gap after the star,
     instead of filling the row right after it. */
  .session-row-main { min-width: 0; flex: 1 1 auto; }
  .session-row-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    font-weight: 500;
    margin-bottom: 1px;
  }
  .session-row-meta { color: var(--vscode-descriptionForeground); font-size: 11px; }
  .session-row-actions { display: none; align-items: center; gap: 2px; flex-shrink: 0; }
  .session-row:hover .session-row-actions,
  .session-row.confirming .session-row-actions,
  .session-row.favorited .session-row-actions {
    display: flex;
  }
  /* A favorited row keeps its actions revealed (see above) specifically so
     the filled star stays visible without hovering - otherwise it would be
     impossible to see which sessions are already favorited at a glance.
     Deliberately smaller than the row's other icon buttons - favoriting is
     secondary to the title/time it sits next to. */
  .icon-btn.star-btn { flex-shrink: 0; width: 16px; height: 16px; color: var(--vscode-descriptionForeground); }
  .star-btn svg { width: 11px; height: 11px; }
  .session-row.favorited .star-btn { color: var(--vscode-charts-yellow, var(--vscode-descriptionForeground)); }
  .session-row-checkbox { display: none; flex-shrink: 0; }
  body.select-mode .session-row-checkbox { display: block; }
  body.select-mode .star-btn { display: none; }
  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    background: none;
    border: none;
    border-radius: 4px;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    padding: 0;
  }
  .icon-btn:hover { background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); color: var(--vscode-foreground); }
  .icon-btn.active { background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); color: var(--vscode-foreground); }

  /* in-webview replacements for what would otherwise be native VS Code
     QuickPick/InputBox/warning-dialog popups - those render as OS-chrome
     overlays disconnected from the panel's own dark theme, so session
     actions render as part of this document instead. */
  .session-menu {
    position: fixed;
    z-index: 50;
    min-width: 180px;
    background: var(--vscode-menu-background, var(--vscode-editorWidget-background));
    color: var(--vscode-menu-foreground, var(--vscode-foreground));
    border: 1px solid var(--vscode-menu-border, var(--vscode-panel-border));
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
    padding: 4px;
  }
  .session-menu-item {
    padding: 6px 10px;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
  }
  .session-menu-item:hover { background: var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground)); }
  .session-menu-item.danger { color: var(--vscode-errorForeground); }
  .session-menu-sep { height: 1px; margin: 4px 2px; background: var(--vscode-menu-separatorBackground, var(--vscode-panel-border)); }
  .session-row-title-input {
    width: 100%;
    box-sizing: border-box;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-focusBorder);
    border-radius: 3px;
    font-size: 12px;
    font-family: inherit;
    padding: 1px 4px;
  }
  .session-delete-confirm { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
  .session-delete-confirm span { color: var(--vscode-errorForeground); font-size: 11px; white-space: nowrap; }
  .session-delete-confirm button { padding: 2px 8px; font-size: 11px; }

  .entry {
    margin-top: 0;
    padding: 10px 12px;
    border-radius: 8px;
    max-width: 88%;
  }
  /* full width rather than a narrow right-aligned bubble - not a two-sided
     chat layout. */
  .entry-user-row {
    align-self: stretch;
  }
  .entry-user {
    width: 100%;
    box-sizing: border-box;
    max-width: none;
    background: var(--vscode-list-hoverBackground, var(--vscode-input-background));
    color: var(--vscode-foreground);
    border: 1px solid var(--vscode-panel-border);
  }
  /* groups everything from one user message to the next behind a single
     connecting line, so a response's tool calls and text read as one
     continuous thread rather than unrelated rows. */
  .turn {
    align-self: stretch;
    display: flex;
    flex-direction: column;
    gap: 14px;
    border-left: 2px solid var(--vscode-panel-border);
    margin-left: 3px;
    padding-left: 13px;
  }
  /* the assistant's own turn is plain flowing text, not a bubble: no
     background, no border, no padding, full width - matching Claude
     Code's own transcript, which never boxes or labels its own replies. */
  .entry-assistant {
    align-self: stretch;
    max-width: none;
    padding: 0;
    border-radius: 0;
    background: none;
  }
  .entry-tool {
    align-self: stretch;
    display: flex;
    align-items: center;
    gap: 7px;
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
  }
  .tool-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--vscode-charts-orange, var(--vscode-descriptionForeground));
    flex-shrink: 0;
  }
  .entry p { margin: 4px 0; }
  .entry h1, .entry h2, .entry h3, .entry h4, .entry h5, .entry h6 { margin: 10px 0 4px; }
  .entry ul, .entry ol { margin: 4px 0; padding-left: 22px; }
  .entry blockquote {
    margin: 4px 0;
    padding: 2px 10px;
    border-left: 3px solid var(--vscode-textBlockQuote-border, var(--vscode-panel-border));
    background: var(--vscode-textBlockQuote-background, transparent);
  }
  .entry code {
    font-family: var(--vscode-editor-font-family, monospace);
    background: var(--vscode-textCodeBlock-background);
    padding: 1px 4px;
    border-radius: 3px;
  }
  .entry a { color: var(--vscode-textLink-foreground); }
  .code-block {
    font-family: var(--vscode-editor-font-family, monospace);
    background: var(--vscode-textCodeBlock-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px;
    padding: 8px 10px;
    overflow-x: auto;
    margin: 6px 0;
    position: relative;
  }
  .code-block[data-lang]::before {
    content: attr(data-lang);
    position: absolute;
    top: 2px;
    right: 8px;
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase;
  }
  .code-block code { background: none; padding: 0; white-space: pre; }
  .tok-comment { color: var(--vscode-charts-green, var(--vscode-descriptionForeground)); }
  .tok-str { color: var(--vscode-charts-orange, var(--vscode-terminal-ansiRed)); }
  .tok-num { color: var(--vscode-charts-blue, var(--vscode-terminal-ansiBlue)); }
  .tok-kw { color: var(--vscode-charts-purple, var(--vscode-terminal-ansiMagenta)); }

  .thinking { display: flex; align-items: center; gap: 6px; color: var(--vscode-descriptionForeground); }
  .thinking-dots span {
    display: inline-block;
    width: 4px;
    height: 4px;
    margin-right: 2px;
    border-radius: 50%;
    background: currentColor;
    animation: thinking-pulse 1.2s infinite ease-in-out;
  }
  .thinking-dots span:nth-child(2) { animation-delay: 0.2s; }
  .thinking-dots span:nth-child(3) { animation-delay: 0.4s; }
  @keyframes thinking-pulse { 0%, 80%, 100% { opacity: 0.25; } 40% { opacity: 1; } }

  .diff-card {
    align-self: stretch;
    border: 1px solid var(--vscode-focusBorder, var(--vscode-panel-border));
    border-radius: 8px;
    padding: 10px 12px;
    background: var(--vscode-editorWidget-background, var(--vscode-input-background));
  }
  .diff-card-summary { font-weight: 600; margin-bottom: 8px; }
  .diff-card-actions { display: flex; gap: 8px; margin-top: 8px; }
  .diff-card-resolved { color: var(--vscode-descriptionForeground); font-style: italic; padding: 8px 12px; }

  /* A long message collapses to a fixed height with a fade and a
     bottom-right "Show more"/"Show less" toggle, rather than pushing
     everything after it far down the transcript. */
  .collapsible.collapsed { max-height: 320px; overflow: hidden; position: relative; }
  .collapsible.collapsed::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 48px;
    background: linear-gradient(to bottom, transparent, var(--vscode-sideBar-background));
    pointer-events: none;
  }
  .collapse-toggle-row { display: flex; justify-content: flex-end; margin-top: 4px; }

  .diff-file + .diff-file { margin-top: 10px; }
  .diff-file-path {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
    margin-bottom: 4px;
  }
  .diff-file-body {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    overflow: hidden;
  }
  .diff-line { padding: 1px 8px; white-space: pre-wrap; word-break: break-word; }
  .diff-line-add { background: var(--vscode-diffEditor-insertedTextBackground, rgba(80, 200, 120, 0.15)); color: var(--vscode-foreground); }
  .diff-line-remove { background: var(--vscode-diffEditor-removedTextBackground, rgba(220, 90, 90, 0.15)); color: var(--vscode-foreground); }
  .diff-line-sep { color: var(--vscode-descriptionForeground); text-align: center; padding: 2px 8px; }

  .tool-io {
    margin-top: 4px;
    margin-left: 13px;
    background: var(--vscode-textCodeBlock-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    padding: 8px 10px;
  }
  .tool-io-label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: var(--vscode-descriptionForeground);
    margin-bottom: 2px;
  }
  .tool-io-label:not(:first-child) { margin-top: 8px; }
  .tool-io-line {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .tool-io-out { color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
${bodyHtml}
<script nonce="${cspNonce}">
${scriptBody}
</script>
</body>
</html>`;
}
