/**
 * parses Server-Sent Events out of a raw byte-chunk stream - not a
 * `Response`, so a caller that already owns a `ReadableStreamDefaultReader`
 * (a proxy relaying bytes to its own client while also parsing them) can
 * feed the exact same chunks in without a second fetch.
 */
export async function* parseSseLines(chunks: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of chunks) {
    buffer += decoder.decode(chunk, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice("data:".length).trim();
      if (payload) yield payload;
    }
  }
}

/** adapts a fetch `Response` into the chunk source `parseSseLines` expects - the common case for a client making its own request. */
export function bodyChunks(response: Response): AsyncIterable<Uint8Array> {
  if (!response.body) return (async function* () {})();
  return response.body as unknown as AsyncIterable<Uint8Array>;
}
