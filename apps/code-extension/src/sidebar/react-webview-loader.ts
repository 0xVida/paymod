import * as vscode from "vscode";
import { readFile } from "node:fs/promises";
import { nonce } from "./webview-html.js";

/**
 * loads the Vite-built React app (`apps/code-webview-ui`) for `ChatPanel`
 * only - `SessionListProvider`'s sidebar keeps its hand-templated HTML.
 * Rewrites Vite's relative asset URLs to `webview.asWebviewUri` URIs and
 * injects a nonce-based CSP: `style-src` allows `'unsafe-inline'` because
 * mermaid injects inline `<style>` elements internally (markdown's raw
 * HTML is never enabled, so this can't be reached via content). `script-src`
 * is nonce-locked plus `'strict-dynamic'`, since a dynamic `import()` for
 * mermaid's lazy-loaded chunks doesn't inherit the parent script's nonce.
 */
export async function renderReactWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): Promise<string> {
  const distUri = vscode.Uri.joinPath(extensionUri, "dist", "webview-ui");
  let html = await readFile(vscode.Uri.joinPath(distUri, "index.html").fsPath, "utf8");

  html = html.replace(/(src|href)="(\.\/[^"]+)"/g, (_match, attr: string, relativePath: string) => {
    const assetUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, relativePath));
    return `${attr}="${assetUri.toString()}"`;
  });

  const cspNonce = nonce();
  html = html.replace('<script type="module"', `<script nonce="${cspNonce}" type="module"`);
  html = html.replace(
    "</head>",
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${cspNonce}' 'strict-dynamic';" />\n</head>`,
  );

  return html;
}
