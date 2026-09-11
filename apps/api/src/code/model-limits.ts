/**
 * the server-enforced output ceiling: a client-supplied max output token
 * value is never trusted past this, whether or not one was even supplied
 * (Anthropic requires it; OpenAI doesn't, so an absent value falls back
 * to the ceiling itself rather than an unbounded generation).
 */
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;

const SERVER_MAX_OUTPUT: Record<string, number> = {
  "gpt-4o": 16384,
  "gpt-4o-mini": 16384,
  "gpt-4.1": 32768,
  "gpt-4.1-mini": 32768,
  "o3": 100000,
  "o3-mini": 100000,
  "gpt-5.6-sol": 128000,
  "gpt-5.6-terra": 128000,
  "gpt-5.6-luna": 128000,
  "claude-3-5-sonnet-20241022": 8192,
  "claude-3-5-sonnet-latest": 8192,
  "claude-3-7-sonnet-20250219": 64000,
  "claude-opus-4-20250514": 32000,
  "claude-sonnet-4-20250514": 64000,
  "claude-sonnet-5": 128000,
  "claude-opus-5": 128000,
  "claude-haiku-4-5": 64000,
  "claude-haiku-4-5-20251001": 64000,
};

export function getServerMaxOutput(model: string): number {
  return SERVER_MAX_OUTPUT[model] ?? DEFAULT_MAX_OUTPUT_TOKENS;
}

/** `min(requested ?? modelDefault, serverCeiling)` - the one line that keeps a client from reserving or generating past what the server allows. */
export function resolveEffectiveMaxOutput(model: string, requested: number | undefined): number {
  const ceiling = getServerMaxOutput(model);
  if (requested === undefined || requested <= 0) return ceiling;
  return Math.min(requested, ceiling);
}

/** Anthropic's wire format uses `max_tokens`; OpenAI's now uses `max_completion_tokens` (`max_tokens` is deprecated there and outright rejected by o-series and the gpt-5.6 family) - checks both since either could be the real field depending on which provider sent this body. */
export function extractRequestedMaxOutput(body: unknown): number | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const record = body as Record<string, unknown>;
  const value = record["max_completion_tokens"] ?? record["max_tokens"];
  return typeof value === "number" ? value : undefined;
}
