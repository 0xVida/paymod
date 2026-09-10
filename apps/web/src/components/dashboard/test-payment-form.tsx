"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, describeError } from "@/lib/api";
import { parseHumanAmount, USDC_DECIMALS } from "@/lib/format";

type TransferResponse = {
  requestId: string;
  intentId: string;
  status: "AUTHORIZED" | "WAITING_APPROVAL" | "DENIED";
  reason?: string;
};

type IntentDetail = {
  status:
    | "PENDING"
    | "WAITING_APPROVAL"
    | "AUTHORIZED"
    | "PROCESSING"
    | "COMPLETED"
    | "DENIED"
    | "FAILED"
    | "CANCELLED"
    | "EXPIRED";
  decision: string | null;
  decisionReason: string | null;
  settlement: {
    status: "PREPARING" | "SUBMITTED" | "CONFIRMED" | "FAILED" | "UNKNOWN";
    txHash: string | null;
  } | null;
};

const TERMINAL_INTENT_STATUSES = new Set(["COMPLETED", "FAILED", "DENIED", "CANCELLED", "EXPIRED"]);
const POLL_INTERVAL_MS = 1500;
const MAX_POLL_ATTEMPTS = 20;

type Trace = {
  requestId: string;
  intentId: string;
  createResult: TransferResponse["status"];
  reason: string | undefined;
  intent?: IntentDetail;
  polling: boolean;
  timedOut: boolean;
};

export function TestPaymentForm({ accountId, walletId }: { accountId: string; walletId: string }) {
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("0.01");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trace, setTrace] = useState<Trace | null>(null);
  const stoppedRef = useRef(false);

  async function poll(intentId: string, attempt: number) {
    if (stoppedRef.current) return;
    let intent: IntentDetail;
    try {
      intent = await api.get<IntentDetail>(
        `/v1/wallets/${walletId}/test-transfer/${intentId}?accountId=${accountId}`,
      );
    } catch {
      return;
    }
    if (stoppedRef.current) return;

    const done =
      TERMINAL_INTENT_STATUSES.has(intent.status) && intent.settlement?.status !== "PREPARING";
    setTrace((prev) => (prev ? { ...prev, intent, polling: !done, timedOut: false } : prev));

    if (done) return;
    if (attempt >= MAX_POLL_ATTEMPTS) {
      setTrace((prev) => (prev ? { ...prev, polling: false, timedOut: true } : prev));
      return;
    }
    setTimeout(() => void poll(intentId, attempt + 1), POLL_INTERVAL_MS);
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setTrace(null);
    stoppedRef.current = false;
    try {
      const result = await api.post<TransferResponse>(`/v1/wallets/${walletId}/test-transfer`, {
        accountId,
        amount: parseHumanAmount(amount, USDC_DECIMALS),
        destination: destination.trim(),
      });
      setTrace({
        requestId: result.requestId,
        intentId: result.intentId,
        createResult: result.status,
        reason: result.reason,
        polling: result.status !== "DENIED",
        timedOut: false,
      });
      if (result.status !== "DENIED") void poll(result.intentId, 1);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
        <div className="space-y-2">
          <Label>Recipient address</Label>
          <Input
            placeholder="0x..."
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label>Amount (USDC)</Label>
          <Input
            placeholder="0.01"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </div>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Sending..." : "Run through Paymod"}
        </Button>
      </form>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {trace && <TraceView trace={trace} />}
    </div>
  );
}

function TraceView({ trace }: { trace: Trace }) {
  const intent = trace.intent;
  const decision =
    trace.createResult === "DENIED"
      ? "DENY"
      : trace.createResult === "WAITING_APPROVAL"
        ? "REQUIRE_APPROVAL"
        : "ALLOW";

  return (
    <div className="space-y-2 rounded-lg border p-4 text-sm">
      <TraceLine label="Intent created" done />
      <TraceLine
        label={`Policy evaluated${decision ? `: ${decision}` : ""}`}
        done
        note={trace.reason}
      />
      {trace.createResult === "DENIED" && (
        <p className="text-xs text-destructive">
          This test payment was denied by policy. Adjust spending authority above and try again.
        </p>
      )}
      {trace.createResult === "WAITING_APPROVAL" && (
        <p className="text-xs text-muted-foreground">
          Waiting on approval. Approve it from your configured approval channel, or check{" "}
          <Link href="/dashboard/activity" className="underline underline-offset-2">
            Activity
          </Link>
          .
        </p>
      )}
      {trace.createResult === "AUTHORIZED" && (
        <>
          <TraceLine label="Execution authorized" done />
          <TraceLine
            label="Transaction submitted"
            done={!!intent?.settlement && intent.settlement.status !== "PREPARING"}
            pending={trace.polling}
          />
          <TraceLine
            label="Settlement confirmed"
            done={intent?.settlement?.status === "CONFIRMED" || intent?.status === "COMPLETED"}
            failed={intent?.settlement?.status === "FAILED" || intent?.status === "FAILED"}
            pending={trace.polling}
          />
          {intent?.settlement?.txHash && (
            <p
              className="truncate font-mono text-xs text-muted-foreground"
              title={intent.settlement.txHash}
            >
              tx: {intent.settlement.txHash}
            </p>
          )}
          {trace.timedOut && (
            <p className="text-xs text-muted-foreground">
              Still settling. Check{" "}
              <Link href="/dashboard/activity" className="underline underline-offset-2">
                Activity
              </Link>{" "}
              for the final result.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function TraceLine({
  label,
  done,
  pending,
  failed,
  note,
}: {
  label: string;
  done: boolean;
  pending?: boolean;
  failed?: boolean;
  note?: string | undefined;
}) {
  const symbol = failed ? "✗" : done ? "✓" : pending ? "…" : "○";
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={failed ? "text-destructive" : done ? "text-primary" : "text-muted-foreground"}
        >
          {symbol}
        </span>
        <span>{label}</span>
      </span>
      {note && <span className="text-xs text-muted-foreground">{note}</span>}
    </div>
  );
}
