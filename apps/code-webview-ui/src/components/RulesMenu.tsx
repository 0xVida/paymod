import { useState } from "react";
import type { RuleFile } from "@paymod/code-core/browser";

type Props = {
  ruleFiles: RuleFile[];
  onToggle: (path: string, enabled: boolean) => void;
};

/** toggles which discovered rule files (CLAUDE.md, AGENTS.md, etc.) the next turn's system prompt includes - real files found in the workspace, not a mock. */
export function RulesMenu({ ruleFiles, onToggle }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="toolbar-popover-anchor">
      <button type="button" className="icon-btn" title="Project rules" aria-label="Project rules" onClick={() => setOpen((value) => !value)}>
        <span className="codicon codicon-checklist" />
      </button>
      {open && (
        <>
          <div className="toolbar-popover-backdrop" onClick={() => setOpen(false)} />
          <div className="toolbar-popover">
            <div className="toolbar-popover-title">Project rules</div>
            {ruleFiles.length === 0 ? (
              <div className="toolbar-popover-empty">No CLAUDE.md, AGENTS.md or similar rule file found in this workspace.</div>
            ) : (
              ruleFiles.map((rule) => (
                <label key={rule.path} className="toolbar-popover-row">
                  <input type="checkbox" checked={rule.enabled} onChange={(event) => onToggle(rule.path, event.target.checked)} />
                  <span>{rule.path}</span>
                </label>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
