import { Collapsible } from "./Collapsible";

/** a plain flowing box, not a bubble - only the user's own message collapses when long, assistant responses never do. */
export function UserMessage({ text }: { text: string }) {
  return (
    <div className="entry-user-row">
      <Collapsible className="entry entry-user">{text}</Collapsible>
    </div>
  );
}
