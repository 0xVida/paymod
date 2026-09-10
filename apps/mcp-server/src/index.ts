#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PaymodClient } from "@paymod/sdk";
import { startMcpHttpServer } from "./http.js";
import { registerPaymodTools } from "./tools.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function startStdioServer(): Promise<void> {
  const client = new PaymodClient({
    apiKey: requireEnv("PAYMOD_API_KEY"),
    ...(process.env.PAYMOD_API_URL !== undefined && { baseUrl: process.env.PAYMOD_API_URL }),
  });

  const server = new McpServer({ name: "paymod", version: "0.1.0" });
  registerPaymodTools(server, client);

  await server.connect(new StdioServerTransport());
}

async function main(): Promise<void> {
  const transport = process.env.PAYMOD_MCP_TRANSPORT ?? "stdio";
  if (transport === "stdio") return startStdioServer();
  if (transport !== "http") throw new Error("PAYMOD_MCP_TRANSPORT must be stdio or http");

  const port = Number(process.env.PORT ?? "3002");
  if (!Number.isInteger(port) || port < 1) throw new Error("PORT must be a positive integer");
  await startMcpHttpServer({ apiUrl: requireEnv("PAYMOD_API_URL"), introspectionSecret: requireEnv("PAYMOD_MCP_INTROSPECTION_SECRET"), oauthIssuer: requireEnv("PAYMOD_OAUTH_ISSUER"), resourceUrl: requireEnv("PAYMOD_MCP_RESOURCE_URL") }, port);
}

main().catch((error) => {
  console.error("paymod-mcp-server failed to start:", error);
  process.exit(1);
});
