"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api, describeError } from "@/lib/api";

type Outcome = "approved" | "denied";

export function DeviceApprovalCard({
  accountName,
  initialUserCode,
}: {
  accountName: string;
  initialUserCode: string;
}) {
  const [userCode, setUserCode] = useState(initialUserCode.toUpperCase());
  const [loading, setLoading] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  async function resolve(action: "approve" | "deny") {
    setError(null);
    setLoading(action);
    try {
      await api.post(`/v1/code/device/${action}`, { userCode });
      setOutcome(action === "approve" ? "approved" : "denied");
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(null);
    }
  }

  if (outcome === "approved") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Connected</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Paymod Code is now linked to {accountName}. Return to your editor to continue.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (outcome === "denied") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Request denied</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            This device will not be connected to {accountName}.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Enter the code from your editor</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Code</Label>
          <Input
            value={userCode}
            onChange={(event) => setUserCode(event.target.value.toUpperCase())}
            placeholder="XXXX-XXXX"
            className="text-center font-mono text-lg tracking-widest"
            autoFocus
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button
            className="flex-1"
            disabled={!userCode || loading !== null}
            onClick={() => resolve("approve")}
          >
            {loading === "approve" ? "Connecting..." : "Connect"}
          </Button>
          <Button
            variant="outline"
            className="flex-1"
            disabled={!userCode || loading !== null}
            onClick={() => resolve("deny")}
          >
            {loading === "deny" ? "Denying..." : "Deny"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
