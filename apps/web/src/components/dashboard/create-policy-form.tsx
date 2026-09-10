"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, describeError } from "@/lib/api";
import {
  POLICY_TYPES,
  configShapeFor,
  describePolicyType,
  type PolicyType,
} from "@/lib/policy-types";
import { parseHumanAmount, USDC_DECIMALS } from "@/lib/format";

const ACCOUNT_WIDE = "__account_wide__";

type FormValues = { type: PolicyType | ""; walletId: string; amount: string; list: string };
type Wallet = { id: string; name: string };

export function CreatePolicyForm({ accountId, wallets }: { accountId: string; wallets: Wallet[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, watch, setValue, formState } = useForm<FormValues>({
    defaultValues: {
      type: "",
      walletId: "",
      amount: "",
      list: "",
    },
  });
  const type = watch("type");
  const walletId = watch("walletId");
  const shape = type ? configShapeFor(type) : null;

  async function onSubmit(values: FormValues) {
    setError(null);
    if (!values.type || !values.walletId || !shape) return;
    try {
      const config =
        shape.kind === "amount"
          ? { [shape.field]: parseHumanAmount(values.amount, USDC_DECIMALS) }
          : {
              values: values.list
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean),
            };

      await api.put("/v1/policies", {
        accountId,
        walletId: values.walletId === ACCOUNT_WIDE ? null : values.walletId,
        type: values.type,
        config,
      });
      setValue("amount", "");
      setValue("list", "");
      router.refresh();
    } catch (err) {
      setError(describeError(err));
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(12rem,.85fr)_auto] lg:items-end">
      <div className="space-y-2">
        <Label>Rule type</Label>
        <Select value={type} onValueChange={(value) => setValue("type", value as PolicyType)}>
          <SelectTrigger className="h-[2.65rem] w-full">
            <SelectValue placeholder="Choose a rule" />
          </SelectTrigger>
          <SelectContent>
            {POLICY_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {describePolicyType(t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Scope</Label>
        <Select value={walletId} onValueChange={(value) => setValue("walletId", value)}>
          <SelectTrigger className="h-[2.65rem] w-full">
            <SelectValue placeholder="Choose a wallet" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ACCOUNT_WIDE}>Account-wide (ceiling only)</SelectItem>
            {wallets.map((wallet) => (
              <SelectItem key={wallet.id} value={wallet.id}>
                {wallet.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {shape?.kind === "amount" ? (
        <div className="space-y-2">
          <Label>Amount (USDC)</Label>
          <Input
            placeholder="0.50"
            inputMode="decimal"
            {...register("amount", { required: "Enter an amount" })}
          />
        </div>
      ) : shape?.kind === "list" ? (
        <div className="space-y-2">
          <Label>Values (comma-separated)</Label>
          <Input placeholder="USDC, XLM" {...register("list", { required: "Enter one or more values" })} />
        </div>
      ) : (
        <div className="hidden lg:block" />
      )}

      <Button className="h-[2.65rem] lg:min-w-32" type="submit" disabled={formState.isSubmitting || !type || !walletId}>
        {formState.isSubmitting ? "Saving..." : "Add rule"}
      </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {formState.errors.amount && <p className="text-xs text-destructive">{formState.errors.amount.message}</p>}
      {formState.errors.list && <p className="text-xs text-destructive">{formState.errors.list.message}</p>}
      {walletId === ACCOUNT_WIDE && (
        <p className="border-l-2 border-primary pl-3 text-xs leading-5 text-muted-foreground">
          An account-wide rule narrows every wallet&apos;s authority but never grants it. A wallet
          needs its own scoped DAILY_LIMIT, MONTHLY_LIMIT or PER_TRANSACTION_LIMIT rule before it
          can spend at all.
        </p>
      )}
    </form>
  );
}
