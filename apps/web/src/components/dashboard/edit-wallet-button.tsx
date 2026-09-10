"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, describeError } from "@/lib/api";

export function EditWalletButton({
  accountId,
  walletId,
  name,
  description,
}: {
  accountId: string;
  walletId: string;
  name: string;
  description: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [walletName, setWalletName] = useState(name);
  const [walletDescription, setWalletDescription] = useState(description ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveWallet() {
    setLoading(true);
    setError(null);
    try {
      await api.patch(`/v1/wallets/${walletId}`, {
        accountId,
        name: walletName,
        description: walletDescription || null,
      });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        Edit wallet
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit wallet</DialogTitle>
          <DialogDescription>Change the name or description shown in your dashboard.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="wallet-name">Name</Label>
            <Input
              id="wallet-name"
              value={walletName}
              onChange={(event) => setWalletName(event.target.value)}
              placeholder="research-agent"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="wallet-description">Description</Label>
            <Input
              id="wallet-description"
              value={walletDescription}
              onChange={(event) => setWalletDescription(event.target.value)}
              placeholder="Optional"
            />
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" onClick={saveWallet} disabled={loading || !walletName.trim()}>
            {loading ? "Saving..." : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
