"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, describeError } from "@/lib/api";

export function WalletLifecycleActions({
  accountId,
  walletId,
  isProvisioned,
}: {
  accountId: string;
  walletId: string;
  isProvisioned: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isDeployed = isProvisioned;
  const action = isDeployed ? "Close wallet" : "Delete deployment";

  async function runAction() {
    setLoading(true);
    setError(null);
    try {
      if (isDeployed) {
        await api.post(`/v1/wallets/${walletId}/archive`, { accountId });
      } else {
        await api.delete(`/v1/wallets/${walletId}?accountId=${accountId}`);
      }
      router.push("/dashboard/wallets");
      router.refresh();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button type="button" variant="destructive" size="sm" onClick={() => setOpen(true)}>
        {action}
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{action}?</DialogTitle>
          <DialogDescription>
            {isDeployed
              ? "This revokes every API and MCP credential and stops future Paymod spending. The underlying wallet and its funds are unaffected - only Paymod's access is revoked."
              : "This removes the unfinished wallet record. It never finished provisioning, so no funds can be affected."}
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={loading}>
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" variant="destructive" onClick={runAction} disabled={loading}>
            {loading ? "Working..." : action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
