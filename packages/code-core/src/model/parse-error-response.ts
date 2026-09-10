/**
 * every non-ok response a provider adapter sees is JSON in practice, but
 * the exact shape depends on who actually rejected the request:
 *
 *   OpenAI, Anthropic and Paymod's own `PaymodError`: { error: { message } }
 *   a NestJS guard's default HttpException (e.g. an expired credential):
 *     { message, error, statusCode }
 *
 * Parsed into one clean sentence rather than ever surfacing raw JSON or a
 * stack trace to the person using the extension - `runAgentLoop`'s only
 * error-reporting path is `Error.message`, and whatever lands there is
 * exactly what the chat UI shows.
 */
export async function describeProviderError(providerLabel: string, response: Response): Promise<string> {
  const bodyText = await response.text();
  const message = extractMessage(bodyText);
  return message ?? `${providerLabel} couldn't process this request (status ${response.status}).`;
}

function extractMessage(bodyText: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const record = parsed as Record<string, unknown>;

  const nested = record["error"];
  if (typeof nested === "object" && nested !== null && typeof (nested as Record<string, unknown>)["message"] === "string") {
    return (nested as Record<string, unknown>)["message"] as string;
  }
  if (typeof record["message"] === "string") return record["message"];
  return undefined;
}
