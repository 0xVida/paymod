"use client";

import { useState } from "react";

/**
 * Circle wallets have no Paymod-initiated funding step - send USDC to the
 * wallet's own on-chain address from anywhere you already hold funds
 * (an exchange, another wallet, a faucet). unlike the old Freighter flow,
 * this is never a Paymod-signed transaction.
 */
export function FundWalletAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 rounded-md border p-3">
        <span className="truncate font-mono text-sm" title={address}>
          {address}
        </span>
        <button
          type="button"
          onClick={copy}
          className="ml-auto shrink-0 text-xs font-medium text-primary underline underline-offset-2"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        Send USDC on this wallet&apos;s chain directly to this address. Any wallet or exchange you
        already control can send to it.
      </p>
    </div>
  );
}
