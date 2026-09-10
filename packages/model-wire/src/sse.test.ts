import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { parseSseLines } from "./sse.js";

function chunksOf(strings: string[]): AsyncIterable<Uint8Array> {
  const encoder = new TextEncoder();
  return (async function* () {
    for (const value of strings) yield encoder.encode(value);
  })();
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const value of source) out.push(value);
  return out;
}

describe("parseSseLines", () => {
  test("yields each data: payload", async () => {
    const payloads = await collect(parseSseLines(chunksOf(['data: {"a":1}\n', 'data: {"b":2}\n'])));
    assert.deepEqual(payloads, ['{"a":1}', '{"b":2}']);
  });

  test("reassembles a payload split across chunk boundaries", async () => {
    const payloads = await collect(parseSseLines(chunksOf(['data: {"a"', ':1}\n'])));
    assert.deepEqual(payloads, ['{"a":1}']);
  });

  test("ignores non-data lines and blank data payloads", async () => {
    const payloads = await collect(parseSseLines(chunksOf(["event: ping\n", "data: \n", 'data: {"a":1}\n'])));
    assert.deepEqual(payloads, ['{"a":1}']);
  });
});
