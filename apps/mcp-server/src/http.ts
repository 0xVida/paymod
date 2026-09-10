import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { PaymodClient } from "@paymod/sdk";
import { registerPaymodTools } from "./tools.js";

const MAX_BODY_SIZE = 1024 * 1024;

type Session = {
  apiKey: string;
  server: McpServer;
  transport: StreamableHTTPServerTransport;
};

type McpHttpServerOptions = {
  apiUrl: string;
  introspectionSecret: string;
  oauthIssuer: string;
  resourceUrl: string;
  validateAccessToken?: (token: string) => Promise<boolean>;
};

function getAccessToken(request: IncomingMessage): string | undefined {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return undefined;

  const apiKey = authorization.slice("Bearer ".length).trim();
  return apiKey.startsWith("pma_") ? apiKey : undefined;
}

async function hasValidAccessToken(token: string, options: McpHttpServerOptions): Promise<boolean> {
  const response = await fetch(`${options.apiUrl}/v1/oauth/introspect`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-paymod-mcp-secret": options.introspectionSecret },
    body: JSON.stringify({ token }),
  });
  if (!response.ok) return false;
  const body = (await response.json()) as { active?: boolean; resource?: string; scope?: string };
  return body.active === true && body.resource === options.resourceUrl && body.scope?.split(" ").includes("mcp:tools") === true;
}

function hasMatchingApiKey(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

function getHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function sendError(response: ServerResponse, status: number, message: string, resourceUrl?: string): void {
  if (status === 401 && resourceUrl) response.setHeader("www-authenticate", `Bearer resource_metadata="${resourceUrl}/.well-known/oauth-protected-resource", scope="mcp:tools"`);
  sendJson(response, status, {
    jsonrpc: "2.0",
    error: { code: -32000, message },
    id: null,
  });
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_SIZE) throw new Error("Request body is too large");
    chunks.push(buffer);
  }

  const body = Buffer.concat(chunks).toString("utf8");
  if (!body) return undefined;
  return JSON.parse(body) as unknown;
}

function createMcpServer(apiKey: string, apiUrl: string): McpServer {
  const client = new PaymodClient({ apiKey, baseUrl: apiUrl });
  const server = new McpServer({ name: "paymod", version: "0.1.0" });
  registerPaymodTools(server, client);
  return server;
}

function removeSession(sessions: Map<string, Session>, transport: StreamableHTTPServerTransport): void {
  const sessionId = transport.sessionId;
  if (!sessionId || sessions.get(sessionId)?.transport !== transport) return;
  sessions.delete(sessionId);
}

async function createSession(
  sessions: Map<string, Session>,
  apiKey: string,
  apiUrl: string,
): Promise<StreamableHTTPServerTransport> {
  const server = createMcpServer(apiKey, apiUrl);
  let transport: StreamableHTTPServerTransport;

  transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: randomUUID,
    onsessioninitialized: (sessionId) => {
      sessions.set(sessionId, { apiKey, server, transport });
    },
  });
  transport.onclose = () => removeSession(sessions, transport);
  await server.connect(transport as never);
  return transport;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  sessions: Map<string, Session>,
  options: McpHttpServerOptions,
): Promise<void> {
  const apiKey = getAccessToken(request);
  if (!apiKey) return sendError(response, 401, "OAuth access token is required", options.resourceUrl);

  const sessionId = getHeader(request, "mcp-session-id");
  const session = sessionId ? sessions.get(sessionId) : undefined;
  if (sessionId && !session) return sendError(response, 404, "Unknown MCP session");
  if (session && !hasMatchingApiKey(session.apiKey, apiKey)) return sendError(response, 401, "MCP session credential does not match", options.resourceUrl);
  const isValid = options.validateAccessToken ?? ((token: string) => hasValidAccessToken(token, options));
  if (!session && !(await isValid(apiKey))) {
    return sendError(response, 401, "Invalid OAuth access token", options.resourceUrl);
  }

  if (request.method === "POST") {
    const body = await readJsonBody(request);
    if (session) return session.transport.handleRequest(request, response, body);
    if (!isInitializeRequest(body)) return sendError(response, 400, "An initialize request is required");

    const transport = await createSession(sessions, apiKey, options.apiUrl);
    return transport.handleRequest(request, response, body);
  }

  if (!session) return sendError(response, 400, "A valid MCP session is required");
  if (request.method === "GET" || request.method === "DELETE") {
    return session.transport.handleRequest(request, response);
  }

  return sendError(response, 405, "Method not allowed");
}

export function createMcpHttpServer(options: McpHttpServerOptions): Server {
  const sessions = new Map<string, Session>();

  return createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === "/health") return sendJson(response, 200, { ok: true });
    if (path === "/.well-known/oauth-protected-resource" || path === "/mcp/.well-known/oauth-protected-resource") {
      return sendJson(response, 200, { resource: options.resourceUrl, authorization_servers: [options.oauthIssuer], scopes_supported: ["mcp:tools"] });
    }
    if (path !== "/mcp") return sendError(response, 404, "Not found");

    try {
      await handleRequest(request, response, sessions, options);
    } catch (error) {
      console.error("Paymod MCP request failed:", error instanceof Error ? error.message : "unknown error");
      if (!response.headersSent) sendError(response, 500, "Internal server error");
    }
  });
}

export async function startMcpHttpServer(options: McpHttpServerOptions, port: number): Promise<void> {
  const server = createMcpHttpServer(options);
  await new Promise<void>((resolve) => server.listen(port, resolve));
  console.log(`Paymod MCP server listening on port ${port}`);
}
