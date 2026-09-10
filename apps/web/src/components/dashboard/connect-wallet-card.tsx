"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001";

function mcpConfig(): string {
  return JSON.stringify(
    {
      mcpServers: {
        paymod: {
          command: "npx",
          args: ["tsx", "<path-to-paymod>/apps/mcp-server/dist/index.js"],
          env: {
            PAYMOD_API_KEY: "<your API key, from Agent access above>",
            PAYMOD_API_URL: API_URL,
          },
        },
      },
    },
    null,
    2,
  );
}

export function ConnectWalletCard() {
  const [copied, setCopied] = useState(false);

  async function copyConfig() {
    try {
      await navigator.clipboard.writeText(mcpConfig());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard permission denied - the code block is still selectable by hand
    }
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="text-sm font-medium">MCP (Claude Desktop and other local clients)</p>
        <p className="text-xs text-muted-foreground">
          Generate an API key above, drop it into this config and restart your MCP client.
        </p>
        <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 font-mono text-xs">
          {mcpConfig()}
        </pre>
        <Button type="button" variant="outline" size="sm" onClick={copyConfig}>
          {copied ? "Copied" : "Copy configuration"}
        </Button>
      </div>

      <Separator />

      <div className="space-y-1">
        <p className="text-sm font-medium">ChatGPT / OAuth MCP clients</p>
        <p className="text-xs text-muted-foreground">
          These clients start the connection themselves: choose Paymod from within that application,
          sign in and pick this wallet when prompted. Connected applications then appear, and can be
          revoked, from{" "}
          <Link href="/dashboard/settings" className="underline underline-offset-2">
            Settings
          </Link>
          .
        </p>
      </div>

      <Separator />

      <div className="space-y-1">
        <p className="text-sm font-medium">SDK</p>
        <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 font-mono text-xs">
          {`import { PaymodClient } from "@paymod/sdk";

const paymod = new PaymodClient({ apiKey: "<your API key>" });
await paymod.transfer({ amount: "1000000", destination: "G..." });`}
        </pre>
      </div>

      <Separator />

      <div className="space-y-1">
        <p className="text-sm font-medium">REST</p>
        <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 font-mono text-xs">
          {`curl ${API_URL}/v1/transfers \\
  -H "Authorization: Bearer <your API key>" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -H "Content-Type: application/json" \\
  -d '{"amount":"1000000","destination":"G..."}'`}
        </pre>
      </div>
    </div>
  );
}
