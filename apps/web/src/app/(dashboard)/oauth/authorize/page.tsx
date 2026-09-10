"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, describeError } from "@/lib/api";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Me = { account: { accountId: string } };
type Wallet = { id: string; name: string; status: string };

function OAuthAuthorizeContent() {
  const router = useRouter();
  const search = useSearchParams();
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [walletId, setWalletId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const me = await api.get<Me>("/v1/auth/me");
        const response = await api.get<Wallet[]>(`/v1/wallets?accountId=${me.account.accountId}`);
        const active = response.filter((wallet) => wallet.status === "ACTIVE");
        setWallets(active);
        setWalletId(active[0]?.id ?? "");
      } catch (err) {
        const status = err instanceof Error && "status" in err ? (err as { status: number }).status : 0;
        if (status === 401) router.replace(`/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        else setError(describeError(err));
      } finally { setLoading(false); }
    })();
  }, [router]);

  async function approve() {
    setSubmitting(true); setError(null);
    try {
      const body = Object.fromEntries(search.entries());
      const result = await api.post<{ redirect_uri: string }>("/v1/oauth/authorize", { ...body, wallet_id: walletId });
      window.location.assign(result.redirect_uri);
    } catch (err) { setError(describeError(err)); setSubmitting(false); }
  }

  return <AuthShell><Card className="auth-card"><CardHeader><CardTitle>Connect Paymod</CardTitle><CardDescription>Choose the Agent Wallet ChatGPT can access. Its existing policies and approval rules still apply.</CardDescription></CardHeader><CardContent className="space-y-4">{loading ? <p>Checking your account...</p> : wallets.length === 0 ? <p>Create and activate an Agent Wallet before connecting it.</p> : <><label className="block text-sm font-medium" htmlFor="wallet">Agent Wallet</label><select id="wallet" className="w-full rounded-md border bg-background p-2" value={walletId} onChange={(event) => setWalletId(event.target.value)}>{wallets.map((wallet) => <option key={wallet.id} value={wallet.id}>{wallet.name}</option>)}</select><Button className="w-full" disabled={submitting} onClick={approve}>{submitting ? "Connecting..." : "Allow ChatGPT"}</Button></>}{error ? <p className="text-sm text-destructive">{error}</p> : null}</CardContent></Card></AuthShell>;
}

export default function OAuthAuthorizePage() {
  return <Suspense fallback={<AuthShell><p>Preparing Paymod connection...</p></AuthShell>}><OAuthAuthorizeContent /></Suspense>;
}
