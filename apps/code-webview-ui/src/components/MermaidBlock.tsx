import { useEffect, useId, useState } from "react";

let initializedModule: Promise<typeof import("mermaid")> | undefined;

// `mermaid` pulls in every diagram renderer plus katex/cytoscape - multiple
// megabytes most conversations never touch. loading it only when a mermaid
// block actually appears means that weight is never fetched for the common
// case of a conversation with no diagrams at all.
async function loadMermaid() {
  if (!initializedModule) {
    initializedModule = import("mermaid").then((module) => {
      module.default.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
      return module;
    });
  }
  return initializedModule;
}

/** a ```mermaid fenced block renders as an SVG diagram instead of highlighted text - `mermaid.render` is async and throws on malformed diagram source, so a render error falls back to the raw text rather than leaving a blank box. */
export function MermaidBlock({ code }: { code: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    loadMermaid()
      .then((module) => module.default.render(`mermaid-${id}`, code))
      .then((result) => {
        if (!cancelled) setSvg(result.svg);
      })
      .catch((renderError: unknown) => {
        if (!cancelled) setError(renderError instanceof Error ? renderError.message : "Failed to render diagram");
      });
    return () => {
      cancelled = true;
    };
  }, [code, id]);

  if (error) {
    return (
      <pre className="mermaid-error">
        <code>{code}</code>
      </pre>
    );
  }
  if (!svg) return <div className="mermaid-loading">Rendering diagram…</div>;
  // eslint-disable-next-line react/no-danger -- mermaid's own SVG output, rendered under `securityLevel: "strict"` which sanitizes it.
  return <div className="mermaid-diagram" dangerouslySetInnerHTML={{ __html: svg }} />;
}
