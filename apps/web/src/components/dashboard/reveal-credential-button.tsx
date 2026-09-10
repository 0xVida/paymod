"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, describeError } from "@/lib/api";

export function RevealCredentialButton({
  accountId,
  walletId,
}: {
  accountId: string;
  walletId: string;
}) {
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [credentials, setCredentials] = useState<Credential[]>([]);

  useEffect(() => {
    void loadCredentials();
  }, [accountId, walletId]);

  async function loadCredentials() {
    try {
      const result = await api.get<Credential[]>(
        `/v1/wallets/${walletId}/credentials?accountId=${accountId}`,
      );
      setCredentials(result);
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function createCredential() {
    setLoading(true);
    setError(null);
    try {
      const credential = await api.post<{ id: string; prefix: string; secret: string }>(`/v1/wallets/${walletId}/credentials`, {
        accountId,
      });
      setSecret(credential.secret);
      setOpen(true);
      await loadCredentials();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }

  async function revoke(credentialId: string) {
    setLoading(true);
    setError(null);
    try {
      await api.delete(`/v1/wallets/${walletId}/credentials/${credentialId}?accountId=${accountId}`);
      await loadCredentials();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }

  async function rotate(credentialId: string) {
    setLoading(true);
    setError(null);
    try {
      await api.delete(`/v1/wallets/${walletId}/credentials/${credentialId}?accountId=${accountId}`);
      const credential = await api.post<{ secret: string }>(`/v1/wallets/${walletId}/credentials`, {
        accountId,
      });
      setSecret(credential.secret);
      setOpen(true);
      await loadCredentials();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }

  async function copySecret() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Could not copy the API key. Select and copy it manually.");
    }
  }

  return (
    <>
      <div className="space-y-3">
        {credentials.map((credential) => (
          <div
            key={credential.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-xs"
          >
            <div>
              <p className="font-mono">{credential.prefix}…</p>
              <p className="text-muted-foreground">
                {credential.revokedAt
                  ? "Revoked"
                  : credential.lastUsedAt
                    ? `Last used ${new Date(credential.lastUsedAt).toLocaleString()}`
                    : "Never used"}
              </p>
            </div>
            {!credential.revokedAt && (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => rotate(credential.id)} disabled={loading}>
                  Rotate
                </Button>
                <Button variant="destructive" size="sm" onClick={() => revoke(credential.id)} disabled={loading}>
                  Revoke
                </Button>
              </div>
            )}
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={createCredential} disabled={loading}>
          {loading ? "Generating..." : "Generate API key"}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>API key created</DialogTitle>
            <DialogDescription>
              This secret is shown once and cannot be retrieved again. Copy it now and hand it to
              the agent.
            </DialogDescription>
          </DialogHeader>
          <Input
            readOnly
            value={secret ?? ""}
            onFocus={(e) => e.currentTarget.select()}
            className="font-mono text-xs"
          />
          <Button type="button" variant="outline" onClick={copySecret}>
            {copied ? "Copied" : "Copy API key"}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

type Credential = { id: string; prefix: string; lastUsedAt: string | null; revokedAt: string | null };
