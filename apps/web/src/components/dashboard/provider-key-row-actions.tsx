"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { api, describeError } from "@/lib/api";

export function ProviderKeyRowActions({ id, isActive }: { id: string; isActive: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function revoke() {
    setLoading(true);
    setError(null);
    try {
      await api.delete(`/v1/admin/provider-keys/${id}`);
      router.refresh();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }

  if (!isActive) return null;

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="destructive" size="sm" onClick={revoke} disabled={loading}>
        {loading ? "Revoking..." : "Revoke"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
