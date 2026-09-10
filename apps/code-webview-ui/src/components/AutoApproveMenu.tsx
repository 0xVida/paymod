import { useState } from "react";
import type { ConfigurableTool } from "@paymod/code-core/browser";

type Props = {
  tools: ConfigurableTool[];
  onToggle: (toolName: string, enabled: boolean) => void;
};

/** surfaces the agent loop's own permission tiers (packages/code-core/src/agent/permissions.ts) - only "configurable" tools are offered here. "approval" tools like run_command always prompt by design and aren't toggleable. */
export function AutoApproveMenu({ tools, onToggle }: Props) {
  const [open, setOpen] = useState(false);
  const approvedCount = tools.filter((tool) => tool.autoApproved).length;

  return (
    <div className="toolbar-popover-anchor">
      <button type="button" className="icon-btn" title="Auto-approve" aria-label="Auto-approve" onClick={() => setOpen((value) => !value)}>
        <span className="codicon codicon-shield" />
        {approvedCount > 0 && <span className="icon-btn-badge">{approvedCount}</span>}
      </button>
      {open && (
        <>
          <div className="toolbar-popover-backdrop" onClick={() => setOpen(false)} />
          <div className="toolbar-popover">
            <div className="toolbar-popover-title">Auto-approve</div>
            {tools.length === 0 ? (
              <div className="toolbar-popover-empty">No configurable tools.</div>
            ) : (
              tools.map((tool) => (
                <label key={tool.name} className="toolbar-popover-row" title={tool.description}>
                  <input type="checkbox" checked={tool.autoApproved} onChange={(event) => onToggle(tool.name, event.target.checked)} />
                  <span>{tool.name}</span>
                </label>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
