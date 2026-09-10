import type { ContextMentionCategory } from "@paymod/code-core/browser";

const CATEGORIES: { id: ContextMentionCategory; label: string }[] = [
  { id: "file", label: "Files" },
  { id: "folder", label: "Folders" },
  { id: "problem", label: "Problems" },
  { id: "gitCommit", label: "Commits" },
];

type Props = {
  category: ContextMentionCategory;
  items: string[];
  highlight: number;
  onSelectCategory: (category: ContextMentionCategory) => void;
  onSelectItem: (item: string) => void;
};

/** the composer's "@" mention menu - a row of category tabs (Cline searches files/folders/problems/git commits from one menu, ours splits them into explicit tabs since VS Code's own extension host has to run a different real query per category) above the live-filtered result list for whichever tab is active. */
export function ContextMenu({ category, items, highlight, onSelectCategory, onSelectItem }: Props) {
  return (
    <div className="context-menu">
      <div className="context-menu-tabs">
        {CATEGORIES.map((entry) => (
          <button key={entry.id} type="button" className={`context-menu-tab${entry.id === category ? " active" : ""}`} onMouseDown={(event) => (event.preventDefault(), onSelectCategory(entry.id))}>
            {entry.label}
          </button>
        ))}
      </div>
      {items.length === 0 ? (
        <div className="context-menu-empty">No matches</div>
      ) : (
        <div className="context-menu-items">
          {items.map((item, index) => (
            <div key={item} className={`mention-item${index === highlight ? " mention-item-active" : ""}`} onMouseDown={(event) => (event.preventDefault(), onSelectItem(item))}>
              {item}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
