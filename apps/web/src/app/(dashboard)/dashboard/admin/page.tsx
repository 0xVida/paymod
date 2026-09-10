import { getSession } from "@/lib/session";
import { serverGet } from "@/lib/server-api";
import { ApiError } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CreateProviderKeyForm } from "@/components/dashboard/create-provider-key-form";
import { ProviderKeyRowActions } from "@/components/dashboard/provider-key-row-actions";
import { CreateModelPricingForm } from "@/components/dashboard/create-model-pricing-form";

type ProviderKey = { id: string; provider: string; label: string; isActive: boolean; createdAt: string; revokedAt: string | null };
type ModelPricingRow = {
  id: string;
  provider: string;
  model: string;
  inputTokenPriceAtomic: string;
  cachedInputTokenPriceAtomic: string | null;
  outputTokenPriceAtomic: string;
  markupBasisPoints: number;
  version: number;
  effectiveTo: string | null;
};

/**
 * `AdminGuard`-only, not linked from the nav for non-admins, but a direct
 * visit or stale bookmark must still degrade gracefully rather than crash -
 * `ApiError` 401/403 render a plain "no access" state.
 */
export default async function AdminPage() {
  await getSession();

  let providerKeys: ProviderKey[];
  let pricing: ModelPricingRow[];
  try {
    [providerKeys, pricing] = await Promise.all([
      serverGet<ProviderKey[]>("/v1/admin/provider-keys"),
      serverGet<ModelPricingRow[]>("/v1/admin/model-pricing"),
    ]);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      return (
        <div className="dashboard-page max-w-md">
          <div className="dashboard-heading">
            <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
            <p className="text-sm text-muted-foreground">You do not have access to this page.</p>
          </div>
        </div>
      );
    }
    throw err;
  }

  return (
    <div className="dashboard-page space-y-6">
      <div className="dashboard-heading">
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="text-sm text-muted-foreground">
          Provider keys and model pricing for Paymod-managed inference (Paymod Code). Not visible or
          reachable for a regular account.
        </p>
      </div>

      <Card>
        <CardHeader>
          <p className="dashboard-eyebrow">01 Configure</p>
          <CardTitle className="text-xl">Add a provider key</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateProviderKeyForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <p className="dashboard-eyebrow">02 Configured</p>
            <CardTitle className="mt-1 text-xl">Provider keys</CardTitle>
          </div>
          <span className="font-mono text-xs text-muted-foreground">{providerKeys.length} total</span>
        </CardHeader>
        <CardContent>
          {providerKeys.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              No provider keys yet. Every Paymod-managed inference call is refused as unavailable
              until at least one exists.
            </p>
          ) : (
            <div className="divide-y border-y">
              {providerKeys.map((key) => (
                <div key={key.id} className="grid gap-3 py-4 sm:grid-cols-[1fr_auto_auto_auto] sm:items-center">
                  <div>
                    <p className="font-medium">{key.label}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Added {new Date(key.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <span className="font-mono text-xs text-muted-foreground">{key.provider}</span>
                  <Badge variant={key.isActive ? "default" : "secondary"}>{key.isActive ? "Active" : "Revoked"}</Badge>
                  <ProviderKeyRowActions id={key.id} isActive={key.isActive} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <p className="dashboard-eyebrow">03 Configure</p>
          <CardTitle className="text-xl">Add a pricing version</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateModelPricingForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <p className="dashboard-eyebrow">04 History</p>
            <CardTitle className="mt-1 text-xl">Model pricing</CardTitle>
          </div>
          <span className="font-mono text-xs text-muted-foreground">{pricing.length} total</span>
        </CardHeader>
        <CardContent>
          {pricing.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              No pricing configured yet. Every model is unavailable until it has a priced version.
            </p>
          ) : (
            <div className="divide-y border-y">
              {pricing.map((row) => (
                <div key={row.id} className="grid gap-1 py-3 sm:grid-cols-[auto_1fr_1fr_auto_auto] sm:items-center">
                  <span className="font-mono text-xs text-muted-foreground">{row.provider}</span>
                  <p className="font-medium">{row.model}</p>
                  <span className="text-xs text-muted-foreground">
                    in {row.inputTokenPriceAtomic} / out {row.outputTokenPriceAtomic} (per 1M) · {row.markupBasisPoints}bps markup
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">v{row.version}</span>
                  <Badge variant={row.effectiveTo ? "secondary" : "default"}>{row.effectiveTo ? "Superseded" : "Active"}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
