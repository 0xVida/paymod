import Link from "next/link";
import { getSession } from "@/lib/session";
import { serverGet } from "@/lib/server-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CreateWalletFlow } from "@/components/dashboard/create-wallet-flow";

type Wallet = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  externalWalletId: string | null;
  createdAt: string;
};

function statusVariant(status: string): "default" | "secondary" | "destructive" {
  if (status === "ACTIVE") return "default";
  if (status === "ARCHIVED") return "destructive";
  return "secondary";
}

export default async function WalletsPage() {
  const me = await getSession();
  const account = me!.account;
  const wallets = await serverGet<Wallet[]>(`/v1/wallets?accountId=${account.accountId}`);
  const activeWallets = wallets.filter((wallet) => wallet.status === "ACTIVE");
  const unfinishedWallets = wallets.filter(
    (wallet) => wallet.status === "CREATING" && !wallet.externalWalletId,
  );
  const inactiveWallets = wallets.filter(
    (wallet) => wallet.status === "ARCHIVED",
  );

  return (
    <div className="dashboard-page space-y-6">
      <div className="dashboard-heading">
        <h1 className="text-2xl font-semibold tracking-tight">Agent wallets</h1>
        <p className="text-sm text-muted-foreground">
          Each agent wallet is backed by its own Circle-managed wallet: its own balance, its own
          spend policy, its own API key.
        </p>
      </div>

      <Card>
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-6 marker:hidden">
            <div>
              <CardTitle className="text-base">Create an agent wallet</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Provision a Circle-backed wallet and set its spend policy afterward.
              </p>
            </div>
            <span className="text-sm font-medium text-primary group-open:hidden">
              Create wallet
            </span>
            <span className="hidden text-sm font-medium text-muted-foreground group-open:inline">
              Close
            </span>
          </summary>
          <CardContent className="border-t pt-6">
            <CreateWalletFlow accountId={account.accountId} embedded />
          </CardContent>
        </details>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active wallets</CardTitle>
        </CardHeader>
        <CardContent>
          {activeWallets.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              No active wallets yet. Create one when you are ready to connect an agent.
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {activeWallets.map((wallet) => (
                <Link
                  key={wallet.id}
                  href={`/dashboard/wallets/${wallet.id}`}
                  className="group rounded-lg border p-5 transition-colors hover:border-primary"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="font-semibold group-hover:text-primary">{wallet.name}</h2>
                      <p className="mt-1 min-h-10 text-sm text-muted-foreground">
                        {wallet.description || "No description"}
                      </p>
                    </div>
                    <Badge variant={statusVariant(wallet.status)}>{wallet.status}</Badge>
                  </div>
                  <p className="mt-5 text-sm font-medium text-primary">
                    Manage wallet and API keys
                  </p>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {unfinishedWallets.length > 0 && (
        <Card>
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-6 marker:hidden">
              <div>
                <CardTitle className="text-base">Still provisioning</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  {unfinishedWallets.length} wallet{unfinishedWallets.length === 1 ? "" : "s"}{" "}
                  did not finish provisioning on first request. Open one to retry.
                </p>
              </div>
              <span className="text-sm text-muted-foreground group-open:hidden">Show</span>
              <span className="hidden text-sm text-muted-foreground group-open:inline">Hide</span>
            </summary>
            <CardContent className="border-t pt-4">
              <div className="divide-y rounded-lg border">
                {unfinishedWallets.map((wallet) => (
                  <Link
                    key={wallet.id}
                    href={`/dashboard/wallets/${wallet.id}`}
                    className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-accent"
                  >
                    <div>
                      <p className="font-medium">{wallet.name}</p>
                      {wallet.description && (
                        <p className="text-sm text-muted-foreground">{wallet.description}</p>
                      )}
                    </div>
                    <Badge variant={statusVariant(wallet.status)}>{wallet.status}</Badge>
                  </Link>
                ))}
              </div>
            </CardContent>
          </details>
        </Card>
      )}

      {inactiveWallets.length > 0 && (
        <Card>
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-6 marker:hidden">
              <div>
                <CardTitle className="text-base">Closed wallets</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  {inactiveWallets.length} closed or paused wallet
                  {inactiveWallets.length === 1 ? "" : "s"}.
                </p>
              </div>
              <span className="text-sm text-muted-foreground group-open:hidden">Show</span>
              <span className="hidden text-sm text-muted-foreground group-open:inline">Hide</span>
            </summary>
            <CardContent className="border-t pt-4">
              <div className="divide-y rounded-lg border">
                {inactiveWallets.map((wallet) => (
                  <Link
                    key={wallet.id}
                    href={`/dashboard/wallets/${wallet.id}`}
                    className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-accent"
                  >
                    <div>
                      <p className="font-medium">{wallet.name}</p>
                      <p className="text-sm text-muted-foreground">Paymod access is disabled</p>
                    </div>
                    <Badge variant={statusVariant(wallet.status)}>{wallet.status}</Badge>
                  </Link>
                ))}
              </div>
            </CardContent>
          </details>
        </Card>
      )}
    </div>
  );
}
