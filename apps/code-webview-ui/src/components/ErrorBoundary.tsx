import { Component, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | undefined };

/** surfaces a render error directly in the webview instead of silently failing - the only reliable way to diagnose a rendering bug in a sandboxed webview where DevTools targeting itself has been unreliable. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: undefined };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="entry" style={{ border: "1px solid var(--vscode-errorForeground)", color: "var(--vscode-errorForeground)" }}>
          <strong>Render error</strong>
          <div>{this.state.error.message}</div>
          <div style={{ whiteSpace: "pre-wrap", fontSize: "11px", opacity: 0.8 }}>{this.state.error.stack}</div>
        </div>
      );
    }
    return this.props.children;
  }
}
