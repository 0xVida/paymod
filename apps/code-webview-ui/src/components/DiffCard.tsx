import { useState } from "react";
import { changedLineRange, compactDiffLines, diffLines, type ProposedEdit } from "@paymod/code-core/browser";
import { postToExtension } from "../vscode-api";

function splitPath(path: string): { dir: string; base: string } {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? { dir: "", base: path } : { dir: path.slice(0, slash + 1), base: path.slice(slash + 1) };
}

function openEditedFile(edit: ProposedEdit): void {
  const range = changedLineRange(edit.originalContent, edit.newContent);
  postToExtension({ type: "openFile", path: edit.path, ...(range && { range }) });
}

/** `VSCodeHost.reviewDiff` never opens an editor tab on its own - this is the only trigger for a real diff editor, so nothing appears unless the user actually clicks it. */
function openDiffInEditor(edit: ProposedEdit): void {
  postToExtension({ type: "openDiff", path: edit.path });
}

function DiffFile({ edit }: { edit: ProposedEdit }) {
  const lines = compactDiffLines(diffLines(edit.originalContent, edit.newContent));
  const added = lines.filter((line) => line.kind === "add").length;
  const removed = lines.filter((line) => line.kind === "remove").length;
  const { dir, base } = splitPath(edit.path);
  // large diffs collapse by default - reviewing a 40-file-touching rewrite
  // one line at a time isn't the point of this card, confirming what
  // changed and where is.
  const [collapsed, setCollapsed] = useState(lines.length > 24);

  return (
    <div className="diff-file">
      <div className="diff-file-header">
        <button type="button" className="diff-file-toggle-btn" onClick={() => setCollapsed((value) => !value)}>
          <span className="diff-file-toggle">{collapsed ? "▸" : "▾"}</span>
          <span className="diff-file-dir">{dir}</span>
          <span className="diff-file-base">{base}</span>
        </button>
        <span className="diff-file-stats">
          {added > 0 && <span className="diff-stat-add">+{added}</span>}
          {removed > 0 && <span className="diff-stat-remove">-{removed}</span>}
        </span>
        <button type="button" className="icon-btn diff-file-open" title="Open in editor" aria-label="Open in editor" onClick={() => openDiffInEditor(edit)}>
          <span className="codicon codicon-diff" />
        </button>
      </div>
      {!collapsed && (
        <div className="diff-file-body">
          {lines.map((line, index) =>
            line.kind === "context" ? (
              <div key={index} className="diff-line diff-line-sep">
                {line.text}
              </div>
            ) : (
              <div key={index} className={`diff-line diff-line-${line.kind}`}>
                {line.kind === "add" ? "+" : "-"} {line.text}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}

/** the card's post-decision state - the full diff is gone (reviewing a decided change line by line isn't useful), but each file stays a clickable reference - the file's own real content once accepted, matching where the edit actually landed. */
function ResolvedFileRow({ edit, resolved }: { edit: ProposedEdit; resolved: "accept" | "reject" }) {
  const { dir, base } = splitPath(edit.path);
  const lines = diffLines(edit.originalContent, edit.newContent);
  const added = lines.filter((line) => line.kind === "add").length;
  const removed = lines.filter((line) => line.kind === "remove").length;

  return (
    <div className="diff-file-header diff-file-header-resolved">
      <span className="diff-file-dir">{dir}</span>
      <span className="diff-file-base">{base}</span>
      <span className="diff-file-stats">
        {added > 0 && <span className="diff-stat-add">+{added}</span>}
        {removed > 0 && <span className="diff-stat-remove">-{removed}</span>}
      </span>
      {resolved === "accept" && (
        <button type="button" className="icon-btn diff-file-open" title="Open file" aria-label="Open file" onClick={() => openEditedFile(edit)}>
          <span className="codicon codicon-go-to-file" />
        </button>
      )}
    </div>
  );
}

export function DiffCard({ edits, resolved, onDecide }: { edits: ProposedEdit[]; resolved: "accept" | "reject" | undefined; onDecide: (decision: "accept" | "reject") => void }) {
  if (resolved) {
    return (
      <div className="diff-card diff-card-resolved">
        <div className="diff-card-resolved-summary">{resolved === "accept" ? "Changes accepted." : "Changes rejected."}</div>
        {edits.map((edit) => (
          <ResolvedFileRow key={edit.path} edit={edit} resolved={resolved} />
        ))}
      </div>
    );
  }
  return (
    <div className="diff-card">
      <div className="diff-card-summary">{edits.length === 1 ? "Review 1 change" : `Review ${edits.length} changes`}</div>
      {edits.map((edit) => (
        <DiffFile key={edit.path} edit={edit} />
      ))}
      <div className="diff-card-actions">
        <button onClick={() => onDecide("accept")}>Accept</button>
        <button className="secondary" onClick={() => onDecide("reject")}>
          Reject
        </button>
      </div>
    </div>
  );
}
