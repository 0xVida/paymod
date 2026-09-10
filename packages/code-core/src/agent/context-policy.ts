/**
 * Explicit budget policy, not a single magic percentage. `targetAfterCompactRatio`
 * matters as much as `compactAtRatio`: compacting at 72% and only dropping back to 65%
 * means compacting again almost immediately.
 */
export type ContextPolicy = {
  compactAtRatio: number;
  targetAfterCompactRatio: number;
  recentTailTokens: number;
  minimumSummaryBudget: number;
  reservedOutputTokens: number;
  safetyMarginTokens: number;
};

export const DEFAULT_CONTEXT_POLICY: ContextPolicy = {
  compactAtRatio: 0.72,
  targetAfterCompactRatio: 0.4,
  recentTailTokens: 20_000,
  minimumSummaryBudget: 4_000,
  reservedOutputTokens: 4_096,
  safetyMarginTokens: 1_000,
};

/**
 * what's actually available for conversation content, not the raw advertised context
 * window: room stays reserved for the model's own reply and a safety margin against
 * estimation drift, since `estimateTokens` counts the outgoing request, not a guarantee
 * of what the provider will itself measure.
 */
export function usableConversationBudget(contextWindow: number, policy: ContextPolicy = DEFAULT_CONTEXT_POLICY): number {
  return Math.max(0, contextWindow - policy.reservedOutputTokens - policy.safetyMarginTokens);
}

/**
 * `usedTokens` is expected to be `ModelProvider.estimateTokens()`'s result against the
 * same messages/tools about to be sent - system prompt and tool schemas are already
 * included in that one count, not estimated separately.
 */
export function contextUsageRatio(usedTokens: number, contextWindow: number, policy: ContextPolicy = DEFAULT_CONTEXT_POLICY): number {
  const budget = usableConversationBudget(contextWindow, policy);
  if (budget <= 0) return 1;
  return usedTokens / budget;
}

export function shouldCompact(usedTokens: number, contextWindow: number, policy: ContextPolicy = DEFAULT_CONTEXT_POLICY): boolean {
  return contextUsageRatio(usedTokens, contextWindow, policy) >= policy.compactAtRatio;
}

/**
 * computed once per turn (`runAgentLoop`, via `ModelProvider.estimateTokens`) and
 * persisted/displayed from there; no host or UI re-derives it. `shouldCompact` is
 * carried as a precomputed convenience so a passive UI warning needs no policy copy.
 */
export type ContextUsage = {
  usedTokens: number;
  contextWindow: number;
  ratio: number;
  shouldCompact: boolean;
};

/** shared by every surface that displays this (webview, CLI) so a fix to the clamping/rounding rule only needs to happen once. */
export function contextUsagePercent(contextUsage: ContextUsage): number {
  return Math.min(100, contextUsage.ratio * 100);
}

export function formatContextUsageLine(contextUsage: ContextUsage): string {
  const percent = contextUsagePercent(contextUsage).toFixed(0);
  const warning = contextUsage.shouldCompact ? " - approaching limit" : "";
  return `context: ${percent}% (${contextUsage.usedTokens.toLocaleString()} / ${contextUsage.contextWindow.toLocaleString()} tokens)${warning}`;
}
