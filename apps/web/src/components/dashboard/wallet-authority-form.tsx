"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, describeError } from "@/lib/api";
import { formatAtomicAmount, parseHumanAmount, USDC_DECIMALS } from "@/lib/format";
import type { PolicyType } from "@/lib/policy-types";

type ExistingPolicy = {
  id: string;
  type: PolicyType;
  config: Record<string, unknown>;
  enabled: boolean;
};

type Props = {
  accountId: string;
  walletId: string;
  policies: ExistingPolicy[];
  telegramConnected: boolean;
};

type FieldConfig = {
  type: PolicyType;
  configField: "limitAtomic" | "thresholdAtomic";
  label: string;
  placeholder: string;
};

const FIELDS: FieldConfig[] = [
  {
    type: "PER_TRANSACTION_LIMIT",
    configField: "limitAtomic",
    label: "Per transaction",
    placeholder: "1.00",
  },
  { type: "DAILY_LIMIT", configField: "limitAtomic", label: "Daily budget", placeholder: "50.00" },
  {
    type: "APPROVAL_THRESHOLD",
    configField: "thresholdAtomic",
    label: "Approval required above",
    placeholder: "25.00",
  },
];

function initialAmounts(policies: ExistingPolicy[]): Record<PolicyType, string> {
  const values = {} as Record<PolicyType, string>;
  for (const field of FIELDS) {
    const existing = policies.find((p) => p.type === field.type && p.enabled);
    const atomic = existing?.config[field.configField];
    values[field.type] =
      typeof atomic === "string" ? formatAtomicAmount(atomic, USDC_DECIMALS) : "";
  }
  return values;
}

export function WalletAuthorityForm({ accountId, walletId, policies, telegramConnected }: Props) {
  const router = useRouter();
  const [amounts, setAmounts] = useState<Record<PolicyType, string>>(() =>
    initialAmounts(policies),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      for (const field of FIELDS) {
        const existing = policies.find((p) => p.type === field.type);
        const raw = amounts[field.type].trim();
        if (!raw && !existing) continue;

        if (!raw) {
          if (existing?.enabled) {
            await api.put("/v1/policies", {
              id: existing.id,
              accountId,
              walletId,
              type: field.type,
              config: existing.config,
              enabled: false,
            });
          }
          continue;
        }

        await api.put("/v1/policies", {
          id: existing?.id,
          accountId,
          walletId,
          type: field.type,
          config: { [field.configField]: parseHumanAmount(raw, USDC_DECIMALS) },
          enabled: true,
        });
      }
      router.refresh();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        {FIELDS.map((field) => (
          <div key={field.type} className="space-y-2">
            <Label>{field.label} (USDC)</Label>
            <Input
              placeholder={field.placeholder}
              inputMode="decimal"
              value={amounts[field.type]}
              onChange={(e) => setAmounts((prev) => ({ ...prev, [field.type]: e.target.value }))}
            />
          </div>
        ))}
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        Per transaction and daily budget grant this wallet its actual spending authority. Clearing a
        field disables that rule rather than deleting it.
      </p>
      {amounts["APPROVAL_THRESHOLD"].trim() && !telegramConnected && (
        <p className="border-l-2 border-primary pl-3 text-xs leading-5 text-muted-foreground">
          Telegram is not connected. Payments above this threshold will wait until you{" "}
          <Link href="/dashboard/settings" className="underline underline-offset-2">
            connect an approval channel
          </Link>
          .
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={saving}>
        {saving ? "Saving..." : "Save authority"}
      </Button>
    </form>
  );
}
