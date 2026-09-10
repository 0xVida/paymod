import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * drives the built server over stdio exactly as Claude Desktop would. gated
 * on PAYMOD_MCP_LIVE=1 - needs a running apps/api against a funded Stellar
 * Testnet treasury and a real pm_live_ credential.
 *
 *   npm --workspace @paymod/mcp-server run build
 *   PAYMOD_MCP_LIVE=1 PAYMOD_API_KEY=pm_live_... PAYMOD_API_URL=http://localhost:3001 \
 *     npm --workspace @paymod/mcp-server run test
 */

const enabled = process.env.PAYMOD_MCP_LIVE === "1";

// dist/index.js still imports @paymod/sdk and @paymod/shared as TS source (no
// build step for those packages), so it must run through tsx, not bare node.
// this is the same reason apps/api runs its compiled output via `tsx dist/main.js`.
function serverArgs(): string[] {
  return [new URL("../dist/index.js", import.meta.url).pathname];
}

async function connectClient(env: Record<string, string>): Promise<Client> {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", ...serverArgs()],
    env,
  });
  const client = new Client({ name: "paymod-live-test", version: "0.1.0" });
  await client.connect(transport);
  return client;
}

function parseResult(result: Awaited<ReturnType<Client["callTool"]>>): unknown {
  const block = (result.content as Array<{ type: string; text?: string }>)[0];
  assert.equal(block?.type, "text");
  return JSON.parse(block!.text!);
}

test("live: the server lists all five tools", { skip: !enabled }, async () => {
  const client = await connectClient({
    PAYMOD_API_KEY: process.env.PAYMOD_API_KEY!,
    PAYMOD_API_URL: process.env.PAYMOD_API_URL ?? "http://localhost:3001",
  });
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "paymod_get_balance",
    "paymod_get_budget",
    "paymod_get_request_status",
    "paymod_pay_x402",
    "paymod_transfer",
  ]);
  await client.close();
});

test("live: an agent checks its budget, then sends a transfer within it", { skip: !enabled }, async () => {
  const client = await connectClient({
    PAYMOD_API_KEY: process.env.PAYMOD_API_KEY!,
    PAYMOD_API_URL: process.env.PAYMOD_API_URL ?? "http://localhost:3001",
  });

  const budgetResult = await client.callTool({ name: "paymod_get_budget", arguments: {} });
  const budget = parseResult(budgetResult) as { windows: Array<{ window: string; availableAtomic: string }> };
  const day = budget.windows.find((w) => w.window === "DAY");
  assert.ok(day, "expected a DAY budget window to be configured");
  assert.ok(BigInt(day.availableAtomic) > 0n, "expected headroom before attempting a transfer");

  const transferResult = await client.callTool({
    name: "paymod_transfer",
    arguments: {
      amount: "100000",
      destination: "GDJUR24PJU3XIBZNA6DZT2QVQIQ6ZMMS5A2UO3JG6CPE5TFLG7KNPJ5W",
      purpose: "mcp live test: within budget",
    },
  });
  const transfer = parseResult(transferResult) as { status: string; intentId: string };
  assert.equal(transfer.status, "AUTHORIZED");
  assert.ok(transfer.intentId.startsWith("int_"));

  const statusResult = await client.callTool({
    name: "paymod_get_request_status",
    arguments: { intentId: transfer.intentId },
  });
  const status = parseResult(statusResult) as { id: string };
  assert.equal(status.id, transfer.intentId);

  await client.close();
});

test("live: a transfer over the per-transaction limit is refused, not thrown", { skip: !enabled }, async () => {
  const client = await connectClient({
    PAYMOD_API_KEY: process.env.PAYMOD_API_KEY!,
    PAYMOD_API_URL: process.env.PAYMOD_API_URL ?? "http://localhost:3001",
  });

  const result = await client.callTool({
    name: "paymod_transfer",
    arguments: {
      amount: "999999999",
      destination: "GDJUR24PJU3XIBZNA6DZT2QVQIQ6ZMMS5A2UO3JG6CPE5TFLG7KNPJ5W",
      purpose: "mcp live test: deliberately over limit",
    },
  });

  // a policy DENY is a normal tool result, not an MCP-level error - the model
  // needs the reason as structured data, not a failure it has to recover from.
  assert.notEqual(result.isError, true);
  const denied = parseResult(result) as { status: string; reason: string };
  assert.equal(denied.status, "DENIED");
  assert.ok(denied.reason.length > 0);

  await client.close();
});

test("live: an invalid credential surfaces as a structured tool error", { skip: !enabled }, async () => {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", ...serverArgs()],
    env: { PAYMOD_API_KEY: "pm_live_totallyfake0000000000000000000000000000" },
  });
  const client = new Client({ name: "paymod-live-test", version: "0.1.0" });
  await client.connect(transport);

  const result = await client.callTool({ name: "paymod_get_balance", arguments: {} });
  assert.equal(result.isError, true);
  const body = parseResult(result) as { code: string };
  assert.equal(body.code, "INTERNAL_ERROR"); // unmapped 401 falls back - see toErrorToolResult

  await client.close();
});
