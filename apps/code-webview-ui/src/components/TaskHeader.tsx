import { useState } from "react";
import { contextUsagePercent, type ContextUsage, type ModelUsage } from "@paymod/code-core/browser";

function formatTokenCount(count: number): string {
  if (count < 1000) return String(count);
  return `${(count / 1000).toFixed(1)}k`;
}

type Props = {
  usage: ModelUsage;
  contextUsage: ContextUsage | undefined;
};

/**
 * `usage` is cumulative per-call spend (cost visibility) and must not be
 * compared against the context window - summing every turn's tokens would
 * vastly overcount what's actually sitting in context right now.
 * `contextUsage` is the separate, non-cumulative signal for that
 * (`runAgentLoop`'s `AgentLoopResult.contextUsage`), hidden until the first
 * turn produces one.
 */
export function TaskHeader({ usage, contextUsage }: Props) {
  const [expanded, setExpanded] = useState(false);
  const totalTokens = usage.inputTokens + usage.outputTokens;
  if (totalTokens === 0 && !contextUsage) return null;

  const percentUsed = contextUsage ? contextUsagePercent(contextUsage) : 0;
  const nearLimit = contextUsage?.shouldCompact ?? false;

  return (
    <div className="task-header">
      <button type="button" className="task-header-summary" onClick={() => setExpanded((value) => !value)}>
        <span className={`codicon ${expanded ? "codicon-chevron-down" : "codicon-chevron-right"}`} />
        <span className="task-header-tokens">{formatTokenCount(totalTokens)} tokens</span>
        {contextUsage && (
          <>
            <div className="task-header-bar">
              <div className={`task-header-bar-fill${nearLimit ? " task-header-bar-fill-warning" : ""}`} style={{ width: `${percentUsed}%` }} />
            </div>
            <span className={nearLimit ? "task-header-warning" : "muted"}>
              {percentUsed.toFixed(0)}% of context{nearLimit ? " - approaching limit" : ""}
            </span>
          </>
        )}
      </button>
      {expanded && (
        <div className="task-header-details">
          <div className="task-header-row">
            <span className="muted">Input</span>
            <span>{usage.inputTokens.toLocaleString()}</span>
          </div>
          <div className="task-header-row">
            <span className="muted">Output</span>
            <span>{usage.outputTokens.toLocaleString()}</span>
          </div>
          {usage.cachedInputTokens ? (
            <div className="task-header-row">
              <span className="muted">Cached</span>
              <span>{usage.cachedInputTokens.toLocaleString()}</span>
            </div>
          ) : null}
          {contextUsage && (
            <>
              <div className="task-header-row">
                <span className="muted">Current context</span>
                <span>{contextUsage.usedTokens.toLocaleString()}</span>
              </div>
              <div className="task-header-row">
                <span className="muted">Context window</span>
                <span>{contextUsage.contextWindow.toLocaleString()}</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
