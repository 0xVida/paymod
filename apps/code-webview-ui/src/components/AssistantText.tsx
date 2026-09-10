import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { CodeBlock } from "./CodeBlock";
import { OptionsButtons } from "./OptionsButtons";

const OPTIONS_PATTERN = /\n{0,2}Options:\s*\n((?:[-*]\s+.+(?:\n|$))+)$/;

/** the model ends a reply with a trailing "Options:" bullet list (nudged by the system prompt) when it wants the user to pick from a small set of choices - parsed here into clickable buttons instead of a plain list. */
function parseOptions(text: string): { body: string; options: string[] } | undefined {
  const match = OPTIONS_PATTERN.exec(text);
  if (!match) return undefined;
  const options = match[1]!
    .split("\n")
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter(Boolean);
  if (options.length < 2) return undefined;
  return { body: text.slice(0, match.index), options };
}

type Props = {
  text: string;
  onSelectOption?: ((text: string) => void) | undefined;
};

/** plain flowing text, not a bubble - matching Claude Code's own transcript, which never boxes or labels its own replies. `rehype-highlight` only ever adds `hljs-*` classes (no injected stylesheet, no inline styles), which is what keeps this CSP-clean under a strict style-src. */
export function AssistantText({ text, onSelectOption }: Props) {
  const parsed = onSelectOption ? parseOptions(text) : undefined;
  const body = parsed?.body ?? text;

  return (
    <div className="entry entry-assistant">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={{ pre: CodeBlock }}>
        {body}
      </ReactMarkdown>
      {parsed && onSelectOption && <OptionsButtons options={parsed.options} onSelect={onSelectOption} />}
    </div>
  );
}
