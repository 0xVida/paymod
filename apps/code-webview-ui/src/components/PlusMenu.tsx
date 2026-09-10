import { useState } from "react";

type Props = {
  onUpload: () => void;
  onAddContext: () => void;
};

/** the "+" button opens a popover instead of triggering the native file picker directly - "Upload from computer" is that same picker, "Add context" reuses the "@" button's own insert-and-search behavior, so there are two distinct ways to attach something instead of one button doing one hidden thing. */
export function PlusMenu({ onUpload, onAddContext }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="toolbar-popover-anchor">
      <button type="button" className="icon-btn" title="Add" aria-label="Add" onClick={() => setOpen((value) => !value)}>
        <span className="codicon codicon-add" />
      </button>
      {open && (
        <>
          <div className="toolbar-popover-backdrop" onClick={() => setOpen(false)} />
          <div className="toolbar-popover">
            <div
              className="toolbar-popover-row toolbar-popover-row-clickable"
              onClick={() => {
                setOpen(false);
                onUpload();
              }}
            >
              <span className="codicon codicon-cloud-upload" />
              <span>Upload from computer</span>
            </div>
            <div
              className="toolbar-popover-row toolbar-popover-row-clickable"
              onClick={() => {
                setOpen(false);
                onAddContext();
              }}
            >
              <span className="codicon codicon-mention" />
              <span>Add context</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
