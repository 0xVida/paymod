import { useState } from "react";
import { MODEL_REGISTRY, type InferenceProviderId } from "@paymod/code-core/browser";

type Props = {
  modelId: string;
  byokProviders: InferenceProviderId[];
  onSelect: (modelId: string) => void;
};

/** a popover picker instead of a native `<select>` - matches the composer's other toolbar buttons (MCP servers, rules) rather than looking like a form control. */
export function ModelMenu({ modelId, byokProviders, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const current = MODEL_REGISTRY.find((model) => model.id === modelId);
  const currentIsByok = current ? byokProviders.includes(current.provider) : false;

  return (
    <div className="toolbar-popover-anchor">
      <button type="button" className="icon-btn model-menu-btn" title="Model" aria-label="Model" onClick={() => setOpen((value) => !value)}>
        <span>{current?.label ?? modelId}</span>
        {currentIsByok && <span className="model-menu-byok-badge">your key</span>}
        <span className="codicon codicon-chevron-down" />
      </button>
      {open && (
        <>
          <div className="toolbar-popover-backdrop" onClick={() => setOpen(false)} />
          <div className="toolbar-popover">
            <div className="toolbar-popover-title">Model</div>
            {MODEL_REGISTRY.map((model) => (
              <div
                key={model.id}
                className={`toolbar-popover-row toolbar-popover-row-clickable${model.id === modelId ? " active" : ""}`}
                onClick={() => {
                  onSelect(model.id);
                  setOpen(false);
                }}
              >
                <span className={`codicon codicon-check toolbar-popover-check${model.id === modelId ? "" : " hidden"}`} />
                <span>{model.label}</span>
                {byokProviders.includes(model.provider) && <span className="model-menu-byok-badge">your key</span>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
