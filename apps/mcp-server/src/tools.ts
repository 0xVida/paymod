import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PaymodClient } from "@paymod/sdk";
import { atomicAmountSchema } from "@paymod/shared";
import { toErrorToolResult, toToolResult } from "./tool-result.js";

/**
 * a policy DENY isn't an error path here - transfer() returns it as an
 * ordinary 200 with status "DENIED", so it reaches the model as structured
 * data through the normal success path.
 */
export function registerPaymodTools(server: McpServer, client: PaymodClient): void {
  registerGetBalanceTool(server, client);
  registerGetBudgetTool(server, client);
  registerTransferTool(server, client);
  registerGetRequestStatusTool(server, client);
  registerWaitForRequestTool(server, client);
  registerGetX402ResultTool(server, client);
  registerPayX402Tool(server, client);
}

function registerGetX402ResultTool(server: McpServer, client: PaymodClient): void {
  server.registerTool(
    "paymod_get_x402_result",
    {
      description: "Retrieve the protected resource fetched after an approved x402 request completes.",
      inputSchema: { intentId: z.string().min(1).describe("The intentId returned by paymod_pay_x402.") },
    },
    async ({ intentId }) => {
      try {
        return toToolResult(await client.getX402Result(intentId));
      } catch (error) {
        return toErrorToolResult(error);
      }
    },
  );
}

function registerWaitForRequestTool(server: McpServer, client: PaymodClient): void {
  server.registerTool(
    "paymod_wait_for_request",
    {
      description: "Poll an approval or settlement for up to 60 seconds and return its terminal status. Use after a transfer returns WAITING_APPROVAL.",
      inputSchema: { intentId: z.string().min(1).describe("The intentId returned by paymod_transfer.") },
    },
    async ({ intentId }) => {
      try {
        return toToolResult(await client.waitForRequest(intentId));
      } catch (error) {
        return toErrorToolResult(error);
      }
    },
  );
}

function registerGetBalanceTool(server: McpServer, client: PaymodClient): void {
  server.registerTool(
    "paymod_get_balance",
    { description: "Read the treasury's current USDC balance available to this spender." },
    async () => {
      try {
        return toToolResult(await client.getBalance());
      } catch (error) {
        return toErrorToolResult(error);
      }
    },
  );
}

function registerGetBudgetTool(server: McpServer, client: PaymodClient): void {
  server.registerTool(
    "paymod_get_budget",
    { description: "Read remaining daily and monthly spend budget for this spender, per configured limit." },
    async () => {
      try {
        return toToolResult(await client.getBudget());
      } catch (error) {
        return toErrorToolResult(error);
      }
    },
  );
}

const transferInputShape = {
  amount: atomicAmountSchema.describe(
    "Atomic integer string in the spending wallet's own decimals: 6 decimals on Circle's EVM rail (the current default), 7 on the dormant Stellar rail. \"1000000\" is 1 USDC on Circle, 0.1 USDC on Stellar.",
  ),
  destination: z.string().min(1).describe(
    "Recipient address in the format the spending wallet's rail expects: a 0x... address on Circle's EVM rail, a G... account on Stellar.",
  ),
  purpose: z.string().optional().describe("Human-readable reason for the payment, for the audit log."),
};

function registerTransferTool(server: McpServer, client: PaymodClient): void {
  server.registerTool(
    "paymod_transfer",
    {
      description:
        "Request a USDC transfer from the treasury. Checked against policy before anything moves: " +
        "returns AUTHORIZED (settling shortly), WAITING_APPROVAL (a human must approve) or DENIED " +
        "with a reason: never partially executes.",
      inputSchema: transferInputShape,
    },
    async (args) => {
      try {
        const { amount, destination, purpose } = args;
        return toToolResult(
          await client.transfer({ amount, destination, ...(purpose !== undefined && { purpose }) }),
        );
      } catch (error) {
        return toErrorToolResult(error);
      }
    },
  );
}

function registerGetRequestStatusTool(server: McpServer, client: PaymodClient): void {
  server.registerTool(
    "paymod_get_request_status",
    {
      description: "Look up a financial intent by id: its policy decision and, once settled, the on-chain transaction hash.",
      inputSchema: { intentId: z.string().min(1).describe("The intentId returned by paymod_transfer.") },
    },
    async ({ intentId }) => {
      try {
        return toToolResult(await client.getRequestStatus(intentId));
      } catch (error) {
        return toErrorToolResult(error);
      }
    },
  );
}

function registerPayX402Tool(server: McpServer, client: PaymodClient): void {
  server.registerTool(
    "paymod_pay_x402",
    {
      description:
        "Fetch an x402-protected resource, paying automatically if the server responds 402. Checked against " +
        "policy the same as paymod_transfer: returns the fetched resource on success or WAITING_APPROVAL / " +
        "DENIED with a reason if the payment itself is not authorized.",
      inputSchema: { url: z.string().url() },
    },
    async ({ url }) => {
      try {
        return toToolResult(await client.payX402(url));
      } catch (error) {
        return toErrorToolResult(error);
      }
    },
  );
}
