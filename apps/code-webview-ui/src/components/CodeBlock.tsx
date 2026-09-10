import { isValidElement, useState, type ReactNode } from "react";
import { MermaidBlock } from "./MermaidBlock";

function extractText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return extractText(node.props.children);
  return "";
}

/** react-markdown renders a fenced code block as a bare `<pre><code>` with no header - overriding `pre` here adds the language label + copy button real code-block UIs have, matching Cline's own presentation. */
export function CodeBlock({ children, ...props }: { children?: ReactNode }) {
  const codeElement = Array.isArray(children) ? children[0] : children;
  const className = (isValidElement<{ className?: string }>(codeElement) && codeElement.props.className) || "";
  const lang = /language-(\S+)/.exec(className)?.[1] ?? "";
  const codeText = isValidElement<{ children?: ReactNode }>(codeElement) ? extractText(codeElement.props.children) : "";
  const [copied, setCopied] = useState(false);

  if (lang === "mermaid") return <MermaidBlock code={codeText} />;

  function handleCopy() {
    navigator.clipboard?.writeText(codeText).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  }

  return (
    <div className="code-block-wrap">
      <div className="code-block-header">
        <span className="code-block-lang">{lang}</span>
        <button className="code-block-copy" onClick={handleCopy}>
          <span className={`codicon ${copied ? "codicon-check" : "codicon-copy"}`} /> {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre {...props}>{children}</pre>
    </div>
  );
}
