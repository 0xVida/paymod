import type { ExtensionToWebviewMessage, WebviewToExtensionMessage } from "@paymod/code-core/browser";

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

export function postToExtension(message: WebviewToExtensionMessage): void {
  vscode.postMessage(message);
}

/** returns an unsubscribe function, matching the usual React effect-cleanup shape */
export function onExtensionMessage(handler: (message: ExtensionToWebviewMessage) => void): () => void {
  const listener = (event: MessageEvent) => handler(event.data as ExtensionToWebviewMessage);
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}
