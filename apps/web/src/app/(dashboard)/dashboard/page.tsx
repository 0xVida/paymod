import Link from "next/link";
import { getSession } from "@/lib/session";
import { serverGet } from "@/lib/server-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatAuditAction } from "@/lib/format";

type Wallet = { id: string; name: string; status: string; createdAt: string };
type PoliciesResponse = { policies: { id: string; type: string }[] };
type AuditEvent = { id: string; action: string; actorType: string; createdAt: string };
type TelegramConnection = {
  username: string | null;
  firstName: string | null;
  connectedAt: string;
} | null;

export default async function OverviewPage() {
  const me = await getSession();
  const account = me!.account;

  const [wallets, policies, activity, telegram] = await Promise.all([
    serverGet<Wallet[]>(`/v1/wallets?accountId=${account.accountId}`),
    serverGet<PoliciesResponse>(`/v1/policies?accountId=${account.accountId}`),
    serverGet<{ events: AuditEvent[] }>(`/v1/audit?accountId=${account.accountId}`),
    serverGet<TelegramConnection>("/v1/approvals/telegram").catch(() => null),
  ]);
  const activeWallets = wallets.filter((w) => w.status === "ACTIVE").length;
  const approvalIsRelevant =
    wallets.length > 0 &&
    (telegram !== null || policies.policies.some((p) => p.type === "APPROVAL_THRESHOLD"));

  return (
    <div className="dashboard-page space-y-6">
      <div className="dashboard-heading">
        <h1 className="text-2xl font-semibold tracking-tight">{account.accountName}</h1>
        <p className="text-sm text-muted-foreground">
          Control, fund and monitor every agent wallet from one place.
        </p>
      </div>

      <div
        className={`grid grid-cols-1 gap-4 ${approvalIsRelevant ? "md:grid-cols-3" : "md:grid-cols-2"}`}
      >
        <Card className="dashboard-stat-card">
          <CardHeader>
            <CardDescription>Agent wallets</CardDescription>
            <CardTitle>
              {activeWallets} active
              {wallets.length !== activeWallets ? ` / ${wallets.length} total` : ""}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Each wallet is its own isolated Circle-backed wallet: its own balance, its own policy.
            </p>
          </CardContent>
        </Card>

        <Card className="dashboard-stat-card">
          <CardHeader>
            <CardDescription>Policies</CardDescription>
            <CardTitle>{policies.policies.length}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Spend rules currently enforced, across every wallet.
            </p>
          </CardContent>
        </Card>

        {approvalIsRelevant && (
          <Card className="dashboard-stat-card">
            <CardHeader>
              <CardDescription>Approval channel</CardDescription>
              <CardTitle>{telegram ? "Connected" : "Not connected"}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-4 text-xs text-muted-foreground">
                {telegram
                  ? telegram.username
                    ? `@${telegram.username}`
                    : (telegram.firstName ?? "Telegram approval is ready")
                  : "You have an approval-threshold policy. Connect Telegram to act on it."}
              </p>
              <Button asChild size="sm" variant="outline">
                <Link href="/dashboard/settings">
                  {telegram ? "Manage approvals" : "Connect Telegram"}
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {wallets.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>Create your first agent wallet</CardTitle>
            <CardDescription>
              A wallet is an isolated Circle-backed wallet with its own funds, policy and revocable
              agent credential.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/dashboard/wallets">Create a wallet</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Wallets</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {wallets.slice(0, 4).map((wallet) => (
                <div key={wallet.id} className="flex items-center justify-between gap-3">
                  <Link
                    href={`/dashboard/wallets/${wallet.id}`}
                    className="min-w-0 truncate text-sm font-medium hover:underline"
                  >
                    {wallet.name}
                  </Link>
                  <Badge variant={wallet.status === "ACTIVE" ? "default" : "secondary"}>
                    {wallet.status}
                  </Badge>
                </div>
              ))}
              <Button asChild size="sm" variant="outline">
                <Link href="/dashboard/wallets">View wallets</Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent activity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {activity.events.slice(0, 4).map((event) => (
                <div key={event.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate">{formatAuditAction(event.action)}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {new Date(event.createdAt).toLocaleDateString()}
                  </span>
                </div>
              ))}
              {activity.events.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activity yet.</p>
              ) : null}
              <Button asChild size="sm" variant="outline">
                <Link href="/dashboard/activity">View activity</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
