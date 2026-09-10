import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { postToExtension } from "./vscode-api";
import "@vscode/codicons/dist/codicon.css";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element");

// catches failures outside React's render (module-load errors, unhandled
// rejections) and writes them directly into the page - DevTools targeting
// in this sandboxed webview is unreliable, so this is the only way to see
// a failure that happens before React mounts.
window.addEventListener("error", (event) => {
  container.innerHTML = `<div style="color:var(--vscode-errorForeground);padding:12px;white-space:pre-wrap;">Uncaught error: ${event.message}\n${event.error?.stack ?? ""}</div>`;
});
window.addEventListener("unhandledrejection", (event) => {
  container.innerHTML = `<div style="color:var(--vscode-errorForeground);padding:12px;white-space:pre-wrap;">Unhandled rejection: ${String(event.reason)}</div>`;
});

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

// a message posted before the webview's own `window.addEventListener("message", ...)`
// is registered is simply lost (no built-in queueing) - "ready" tells the
// extension host it's now safe to send the initial `sessionState`.
postToExtension({ type: "ready" });
