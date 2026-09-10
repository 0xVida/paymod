import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

const COLLAPSE_THRESHOLD = 320;

/** collapses to a fixed height with a fade and a bottom-right "Show more"/"Show less" toggle overlapping the box's own corner (not a separate row below it) once the content exceeds the threshold - only ever applied to the user's own sent message, not assistant responses. */
export function Collapsible({ className, children }: { className: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [collapsed, setCollapsed] = useState(true);

  useLayoutEffect(() => {
    if (ref.current) setOverflows(ref.current.scrollHeight > COLLAPSE_THRESHOLD + 40);
  }, [children]);

  const isCollapsed = overflows && collapsed;
  return (
    <div ref={ref} className={`${className}${overflows ? " collapsible" : ""}${isCollapsed ? " collapsed" : ""}`}>
      {children}
      {overflows && (
        <button type="button" className="collapse-toggle" onClick={() => setCollapsed((value) => !value)}>
          {isCollapsed ? "Show more" : "Show less"}
        </button>
      )}
    </div>
  );
}
