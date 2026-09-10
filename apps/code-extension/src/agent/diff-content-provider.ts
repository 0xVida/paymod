import * as vscode from "vscode";

export const DIFF_SCHEME = "paymod-code-diff";

/**
 * shared by `VSCodeHost.reviewDiff` (registers content) and the diff card's
 * "open in editor" button in `ChatPanel` - the URIs must match exactly or
 * `DiffContentProvider` has nothing to serve.
 */
export function diffUrisFor(sessionId: string, path: string): { originalUri: vscode.Uri; proposedUri: vscode.Uri } {
  const session = `session=${encodeURIComponent(sessionId)}`;
  return {
    originalUri: vscode.Uri.parse(`${DIFF_SCHEME}:${encodeURIComponent(path)}.original?${session}`),
    proposedUri: vscode.Uri.parse(`${DIFF_SCHEME}:${encodeURIComponent(path)}.proposed?${session}`),
  };
}

/**
 * backs the two virtual documents `vscode.diff` compares: original and
 * proposed content, neither written to disk until the user accepts.
 * Registered once in `extension.ts`, shared by every `VSCodeHost` instance.
 */
export class DiffContentProvider implements vscode.TextDocumentContentProvider {
  private readonly contents = new Map<string, string>();
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;

  set(uri: vscode.Uri, content: string): void {
    this.contents.set(uri.toString(), content);
    this.emitter.fire(uri);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? "";
  }
}
