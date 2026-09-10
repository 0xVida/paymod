import { getSession } from "@/lib/session";
import { serverGet } from "@/lib/server-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CreatePolicyForm } from "@/components/dashboard/create-policy-form";
import { PolicyRowActions } from "@/components/dashboard/policy-row-actions";
import { describePolicyType, configShapeFor, type PolicyType } from "@/lib/policy-types";
import { formatAtomicAmount, USDC_DECIMALS } from "@/lib/format";

type Policy = {
  id: string;
  type: PolicyType;
  config: Record<string, unknown>;
  walletId: string | null;
  enabled: boolean;
};
type Wallet = { id: string; name: string };

function describePolicyConfig(policy: Policy): string {
  const shape = configShapeFor(policy.type);
  if (shape.kind === "amount") {
    const atomic = policy.config[shape.field];
    return typeof atomic === "string" ? `${formatAtomicAmount(atomic, USDC_DECIMALS)} USDC` : "-";
  }
  const values = policy.config[shape.field];
  return Array.isArray(values) ? values.join(", ") : "-";
}

export default async function PoliciesPage() {
  const me = await getSession();
  const account = me!.account;
  const [{ policies }, wallets] = await Promise.all([
    serverGet<{ policies: Policy[] }>(`/v1/policies?accountId=${account.accountId}`),
    serverGet<Wallet[]>(`/v1/wallets?accountId=${account.accountId}`),
  ]);
  const walletName = (walletId: string | null) =>
    wallets.find((w) => w.id === walletId)?.name ?? walletId;

  return (
    <div className="dashboard-page space-y-6">
      <div className="dashboard-heading">
        <h1 className="text-2xl font-semibold tracking-tight">Policies</h1>
        <p className="text-sm text-muted-foreground">
          Rules the policy engine checks on every transfer and x402 payment, in precedence order. A
          wallet needs at least one budget rule scoped to it before it can spend at all. An
          account-wide rule alone is a ceiling, not authority.
        </p>
      </div>

      <Card>
        <CardHeader>
          <p className="dashboard-eyebrow">01 Configure</p>
          <CardTitle className="text-xl">Add a rule</CardTitle>
        </CardHeader>
        <CardContent>
          <CreatePolicyForm accountId={account.accountId} wallets={wallets} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <p className="dashboard-eyebrow">02 Enforced rules</p>
            <CardTitle className="mt-1 text-xl">Policy set</CardTitle>
          </div>
          <span className="font-mono text-xs text-muted-foreground">{policies.length} total</span>
        </CardHeader>
        <CardContent>
          {policies.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              No policy rules yet. Every transfer is denied until a wallet has its own budget rule.
            </p>
          ) : (
            <div className="divide-y border-y">
              {policies.map((policy) => (
                <div
                  key={policy.id}
                  className="grid gap-3 py-4 sm:grid-cols-[1.2fr_1fr_auto_auto_auto] sm:items-center"
                >
                  <div>
                    <p className="font-medium">{describePolicyType(policy.type)}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {policy.walletId ? walletName(policy.walletId) : "Account-wide ceiling"}
                    </p>
                  </div>
                  <p className="text-sm text-muted-foreground">{describePolicyConfig(policy)}</p>
                  <span className="font-mono text-xs text-muted-foreground">
                    {policy.walletId ? "Wallet" : "Account"}
                  </span>
                  <Badge variant={policy.enabled ? "default" : "secondary"}>
                    {policy.enabled ? "Enabled" : "Disabled"}
                  </Badge>
                  <PolicyRowActions
                    policyId={policy.id}
                    accountId={account.accountId}
                    walletId={policy.walletId}
                    type={policy.type}
                    config={policy.config}
                    enabled={policy.enabled}
                  />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
