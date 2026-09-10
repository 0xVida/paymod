import { parseSseLines } from "./sse.js";
import { parseOpenAiStream } from "./openai-stream.js";
import { parseAnthropicStream } from "./anthropic-stream.js";
import type { ModelUsage } from "./types.js";

export type WireProvider = "openai" | "anthropic";

/**
 * Drains a byte-chunk stream for its final reported usage, ignoring the
 * text/tool-call deltas - what the inference proxy's metering needs from
 * a stream it already relays byte for byte. `undefined` means the stream
 * ended without a `message_stop`: usage is unknown, not zero.
 */
export async function extractFinalUsage(provider: WireProvider, chunks: AsyncIterable<Uint8Array>): Promise<ModelUsage | undefined> {
  const payloads = parseSseLines(chunks);
  const events = provider === "openai" ? parseOpenAiStream(payloads) : parseAnthropicStream(payloads);
  let usage: ModelUsage | undefined;
  for await (const event of events) {
    if (event.type === "message_stop") usage = event.response.usage;
  }
  return usage;
}
