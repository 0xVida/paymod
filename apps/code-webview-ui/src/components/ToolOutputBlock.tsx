import { useMemo, useState } from "react";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import json from "highlight.js/lib/languages/json";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import diff from "highlight.js/lib/languages/diff";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

// the default `highlight.js` export registers ~190 language grammars,
// which alone triples this bundle - tool output realistically only ever
// needs a handful, registered explicitly against the lightweight core.
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("json", json);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("diff", diff);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);

const AUTO_COLLAPSE_LINE_COUNT = 10;

/** command/tool output, syntax-highlighted the same way a fenced markdown code block is - but run through `highlight.js` directly rather than `react-markdown`, since raw stdout/stderr isn't markdown and stray `#`/`*`/`-` characters in real output would otherwise get misparsed as headings or lists. auto-collapses past a line-count threshold with an expand toggle, matching Cline's `CommandOutputRow`. */
export function ToolOutputBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = useMemo(() => text.split("\n"), [text]);
  const overflows = lines.length > AUTO_COLLAPSE_LINE_COUNT;
  const shown = overflows && !expanded ? lines.slice(0, AUTO_COLLAPSE_LINE_COUNT).join("\n") : text;

  const highlighted = useMemo(() => {
    try {
      return hljs.highlightAuto(shown).value;
    } catch {
      return undefined;
    }
  }, [shown]);

  return (
    <div className="tool-output-block">
      {highlighted ? <pre className="tool-output-code"><code dangerouslySetInnerHTML={{ __html: highlighted }} /></pre> : <pre className="tool-output-code"><code>{shown}</code></pre>}
      {overflows && (
        <button type="button" className="tool-output-toggle" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "Show less" : `Show ${lines.length - AUTO_COLLAPSE_LINE_COUNT} more lines`}
        </button>
      )}
    </div>
  );
}
