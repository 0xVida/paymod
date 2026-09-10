"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, describeError } from "@/lib/api";

type CheckDepositResponse = { creditedUsd: number; newDepositCount: number; balanceUsd: number };

/**
 * the dashboard's one deposit-flow surface (PAYMOD_CODE_PLAN.md section 2) -
 * a copyable address plus an "I've sent it" button that triggers one
 * on-demand check, not a background poll. no connect-wallet - the user can
 * send from any wallet or exchange they already have.
 */
export function DepositAddressRow({ address, initialBalanceUsd }: { address: string; initialBalanceUsd: number }) {
  const [copied, setCopied] = useState(false);
  const [balanceUsd, setBalanceUsd] = useState(initialBalanceUsd);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function copy() {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function checkDeposit() {
    setChecking(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.post<CheckDepositResponse>("/v1/code/deposit-address/check");
      setBalanceUsd(result.balanceUsd);
      setMessage(
        result.newDepositCount > 0
          ? `Credited $${result.creditedUsd.toFixed(2)} from ${result.newDepositCount} deposit${result.newDepositCount === 1 ? "" : "s"}.`
          : "No new deposit found yet - it can take a moment to confirm on-chain.",
      );
    } catch (err) {
      setError(describeError(err));
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="text-sm text-muted-foreground">Balance</div>
        <div className="text-3xl font-semibold tracking-tight">${balanceUsd.toFixed(2)}</div>
      </div>
      <div className="space-y-2">
        <div className="text-sm text-muted-foreground">Send USDC on Solana to this address</div>
        <div className="flex items-center gap-2">
          <Input readOnly value={address} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
          <Button type="button" variant="outline" size="sm" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </div>
      <div className="space-y-2">
        <Button type="button" onClick={checkDeposit} disabled={checking}>
          {checking ? "Checking..." : "I've sent it"}
        </Button>
        {message && <p className="text-sm text-muted-foreground">{message}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </div>
  );
}
