import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { createMcpHttpServer } from "./http.js";

const VALID_TOKEN = "pma_abcdefghijklmnopqrstuvwxyz123456";

async function startServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createMcpHttpServer({ apiUrl: "http://localhost:3001", introspectionSecret: "test", oauthIssuer: "http://localhost:3001", resourceUrl: "http://127.0.0.1:3002/mcp", validateAccessToken: async (token) => token === VALID_TOKEN });
  server.listen(0);
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP server address");

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

function mcpHeaders(apiKey: string, sessionId?: string): Record<string, string> {
  return {
    authorization: `Bearer ${apiKey}`,
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    ...(sessionId && { "mcp-session-id": sessionId }),
  };
}

async function readMcpResponse(response: Response): Promise<unknown> {
  const body = await response.text();
  const data = body
    .split("\n")
    .find((line) => line.startsWith("data:"));
  return JSON.parse(data ? data.slice("data:".length).trim() : body) as unknown;
}

test("HTTP MCP requires a wallet credential and keeps it bound to its session", async () => {
  const server = await startServer();
  const apiKey = VALID_TOKEN;

  try {
    const unauthorized = await fetch(`${server.baseUrl}/mcp`, { method: "POST" });
    assert.equal(unauthorized.status, 401);

    const invalid = await fetch(`${server.baseUrl}/mcp`, {
      method: "POST",
      headers: mcpHeaders("pma_invalid"),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    assert.equal(invalid.status, 401);

    const initialized = await fetch(`${server.baseUrl}/mcp`, {
      method: "POST",
      headers: mcpHeaders(apiKey),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "paymod-test", version: "0.1.0" },
        },
      }),
    });
    assert.equal(initialized.status, 200);
    const sessionId = initialized.headers.get("mcp-session-id");
    assert.ok(sessionId);

    const listed = await fetch(`${server.baseUrl}/mcp`, {
      method: "POST",
      headers: mcpHeaders(apiKey, sessionId),
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    });
    assert.equal(listed.status, 200);
    const tools = (await readMcpResponse(listed)) as { result: { tools: Array<{ name: string }> } };
    assert.equal(tools.result.tools.length, 5);

    const mismatchedCredential = await fetch(`${server.baseUrl}/mcp`, {
      method: "POST",
      headers: mcpHeaders("pma_othercredential123456789012345678", sessionId),
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} }),
    });
    assert.equal(mismatchedCredential.status, 401);
  } finally {
    await server.close();
  }
});
