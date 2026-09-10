"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { api, describeError } from "@/lib/api";
import type { PolicyType } from "@/lib/policy-types";

type Props = {
  policyId: string;
  accountId: string;
  walletId: string | null;
  type: PolicyType;
  config: Record<string, unknown>;
  enabled: boolean;
};

export function PolicyRowActions({ policyId, accountId, walletId, type, config, enabled }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setSaving(true);
    setError(null);
    try {
      await api.put("/v1/policies", {
        id: policyId,
        accountId,
        walletId,
        type,
        config,
        enabled: !enabled,
      });
      router.refresh();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="outline" size="sm" onClick={toggle} disabled={saving}>
        {saving ? "Saving..." : enabled ? "Disable" : "Enable"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
