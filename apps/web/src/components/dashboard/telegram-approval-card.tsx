"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, describeError } from "@/lib/api";

type Connection = { username: string | null; firstName: string | null; connectedAt: string } | null;
type Link = { url: string; expiresAt: string };

export function TelegramApprovalCard() {
  const [connection, setConnection] = useState<Connection | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Connection>("/v1/approvals/telegram")
      .then(setConnection)
      .catch((err) => setError(describeError(err)));
  }, []);

  async function connect() {
    setLoading(true);
    setError(null);
    try {
      const link = await api.post<Link>("/v1/approvals/telegram/link");
      window.location.assign(link.url);
    } catch (err) {
      setError(describeError(err));
      setLoading(false);
    }
  }

  async function disconnect() {
    setLoading(true);
    setError(null);
    try {
      await api.delete<{ ok: true }>("/v1/approvals/telegram");
      setConnection(null);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }

  const name = connection?.username
    ? `@${connection.username}`
    : (connection?.firstName ?? "Telegram");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Payment approvals</CardTitle>
        <CardDescription>
          Connect Telegram to approve or deny payments that exceed your wallet policy. Paymod never
          receives your Telegram password or wallet key.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {connection === undefined ? (
          <p className="text-sm text-muted-foreground">Checking connection...</p>
        ) : null}
        {connection ? <p className="text-sm">Connected as {name}.</p> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {connection ? (
          <Button variant="outline" disabled={loading} onClick={disconnect}>
            {loading ? "Disconnecting..." : "Disconnect Telegram"}
          </Button>
        ) : (
          <Button disabled={loading || connection === undefined} onClick={connect}>
            {loading ? "Opening Telegram..." : "Connect Telegram"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
