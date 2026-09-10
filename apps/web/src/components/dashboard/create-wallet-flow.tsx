"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, describeError } from "@/lib/api";

type FormValues = {
  name: string;
  description: string;
};

/**
 * one API call. `POST /v1/wallets` provisions the real wallet with Circle
 * synchronously in the common case (`WalletsController.ensureProvisioned`),
 * so there's no client-signed deploy step and nothing to poll for - the
 * request either returns an active wallet or a real error.
 */
export function CreateWalletFlow({
  accountId,
  embedded = false,
}: {
  accountId: string;
  embedded?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({
    defaultValues: { name: "", description: "" },
  });

  async function onSubmit(values: FormValues) {
    setError(null);
    try {
      await api.post<{ id: string }>("/v1/wallets", {
        accountId,
        name: values.name,
        ...(values.description && { description: values.description }),
      });
      router.refresh();
    } catch (err) {
      setError(describeError(err));
    }
  }

  return (
    <Card className={embedded ? "border-0 shadow-none" : undefined}>
      <CardHeader>
        <CardTitle className="text-base">Create Agent Wallet</CardTitle>
        <CardDescription>
          Paymod provisions a Circle-backed wallet for this agent. Spend limits are configured
          separately on the Policies page and can be changed at any time.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input placeholder="research-agent" {...register("name", { required: "Enter a wallet name" })} />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input placeholder="Optional" {...register("description")} />
            </div>
          </div>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Creating the wallet..." : "Create Agent Wallet"}
          </Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </form>
      </CardContent>
    </Card>
  );
}
