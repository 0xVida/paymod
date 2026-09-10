"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, describeError } from "@/lib/api";

type Connection = {
  id: string;
  clientName: string;
  walletName: string;
  createdAt: string;
  expiresAt: string;
};

export function McpConnectionsCard() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function load() {
    return api
      .get<Connection[]>("/v1/oauth/connections")
      .then(setConnections)
      .catch((err) => setError(describeError(err)))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    void load();
  }, []);

  async function revoke(id: string) {
    try {
      await api.delete(`/v1/oauth/connections/${id}`);
      await load();
    } catch (err) {
      setError(describeError(err));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">MCP connections</CardTitle>
        <CardDescription>
          OAuth connections from ChatGPT and other compatible MCP clients.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? <p className="text-sm text-muted-foreground">Loading connections...</p> : null}
        {!loading && connections.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No connected applications yet. To connect a supported application, start the Paymod
            connection from that application, not from here, then pick a wallet when prompted.
          </p>
        ) : null}
        {connections.map((connection) => (
          <div
            key={connection.id}
            className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 first:border-t-0 first:pt-0"
          >
            <div>
              <p className="font-medium">{connection.clientName}</p>
              <p className="text-xs text-muted-foreground">Wallet: {connection.walletName}</p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={() => revoke(connection.id)}
            >
              Revoke
            </Button>
          </div>
        ))}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
