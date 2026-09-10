"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, describeError } from "@/lib/api";
import { transferUsdc, type FundStep } from "@/lib/stellar-deploy";
import { parseHumanAmount, USDC_DECIMALS } from "@/lib/format";

type FormValues = { destination: string; amount: string };
type Config = { networkPassphrase: string; rpcUrl: string; usdcContractId: string };

const STEP_LABEL: Record<FundStep, string> = {
  connecting: "Connecting to Freighter...",
  sending: "Sending (sign in Freighter)...",
  done: "Sent",
};

/**
 * ad-hoc utility, not a Paymod product feature - plain wallet-to-wallet USDC
 * send signed by whatever Freighter account is connected, with no account,
 * Agent Wallet or audit trail like the dashboard's policy-gated transfers.
 * deliberately unlinked from the dashboard nav.
 */
export default function SendPage() {
  const [step, setStep] = useState<FundStep | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<FormValues>({
    defaultValues: { destination: "GDN24SGG6EUDGPPKCR5WOOHCAIFVNRIFEUBVDWVHOGE4H5PE5KAE2SO6", amount: "" },
  });

  async function onSubmit(values: FormValues) {
    setError(null);
    setSentTo(null);
    try {
      const amountAtomic = parseHumanAmount(values.amount, USDC_DECIMALS);
      const config = await api.get<Config>("/v1/config");
      await transferUsdc(config, { destination: values.destination, amountAtomic }, setStep);
      setSentTo(values.destination);
    } catch (err) {
      setError(describeError(err));
      setStep(null);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6 p-8">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Send USDC</CardTitle>
          <CardDescription>
            Sends from whatever Freighter account is connected in this browser. Confirm the network in Freighter before
            signing. This project is configured for Stellar Testnet.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label>Destination address</Label>
              <Input {...register("destination", { required: true })} />
            </div>
            <div className="space-y-2">
              <Label>Amount (USDC)</Label>
              <Input placeholder="5" {...register("amount", { required: true })} />
            </div>
            <Button type="submit" disabled={formState.isSubmitting || (step !== null && step !== "done")}>
              {step ? STEP_LABEL[step] : "Send from my wallet"}
            </Button>
            {sentTo && <p className="text-sm text-muted-foreground">Sent to {sentTo}.</p>}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
