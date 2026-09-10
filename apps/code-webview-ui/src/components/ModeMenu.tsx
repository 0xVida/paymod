import { useState } from "react";

const MODES: { id: "plan" | "act"; label: string; description: string }[] = [
  { id: "plan", label: "Plan", description: "Investigate and propose an approach without editing" },
  { id: "act", label: "Act", description: "Make changes directly" },
];

type Props = {
  mode: "plan" | "act";
  onChange: (mode: "plan" | "act") => void;
};

/** a popover instead of the old two-state switch - matches the composer's other toolbar buttons. still a real setting that changes the next turn's system prompt, not decorative. */
export function ModeMenu({ mode, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const current = MODES.find((entry) => entry.id === mode)!;

  return (
    <div className="toolbar-popover-anchor">
      <button type="button" className="icon-btn model-menu-btn" title={current.description} aria-label="Mode" onClick={() => setOpen((value) => !value)}>
        <span>{current.label}</span>
        <span className="codicon codicon-chevron-down" />
      </button>
      {open && (
        <>
          <div className="toolbar-popover-backdrop" onClick={() => setOpen(false)} />
          <div className="toolbar-popover toolbar-popover-right">
            <div className="toolbar-popover-title">Mode</div>
            {MODES.map((entry) => (
              <div
                key={entry.id}
                className={`toolbar-popover-row toolbar-popover-row-clickable${entry.id === mode ? " active" : ""}`}
                onClick={() => {
                  onChange(entry.id);
                  setOpen(false);
                }}
              >
                <span className={`codicon codicon-check toolbar-popover-check${entry.id === mode ? "" : " hidden"}`} />
                <div>
                  <div>{entry.label}</div>
                  <div className="toolbar-popover-row-desc">{entry.description}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
