import { getSession } from "@/lib/session";
import { serverGet } from "@/lib/server-api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FundWalletAddress } from "@/components/dashboard/fund-wallet-address";
import { RevealCredentialButton } from "@/components/dashboard/reveal-credential-button";
import { WalletLifecycleActions } from "@/components/dashboard/wallet-lifecycle-actions";
import { EditWalletButton } from "@/components/dashboard/edit-wallet-button";
import { WalletSetupProgress } from "@/components/dashboard/wallet-setup-progress";
import { WalletAuthorityForm } from "@/components/dashboard/wallet-authority-form";
import { TestPaymentForm } from "@/components/dashboard/test-payment-form";
import { ConnectWalletCard } from "@/components/dashboard/connect-wallet-card";
import { Separator } from "@/components/ui/separator";
import { formatAtomicAmount, USDC_DECIMALS } from "@/lib/format";
import type { PolicyType } from "@/lib/policy-types";

type Wallet = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  networkId: string | null;
  externalWalletId: string | null;
  ownerAddress: string | null;
};
type BalanceResponse = { assetCode: string; available: string };
type SetupStatus = {
  deployed: boolean;
  funded: boolean;
  hasAuthority: boolean;
  hasCredential: boolean;
  hasCompletedPayment: boolean;
};
type Policy = {
  id: string;
  type: PolicyType;
  config: Record<string, unknown>;
  enabled: boolean;
  walletId: string | null;
};
type TelegramConnection = { username: string | null; firstName: string | null } | null;

export default async function WalletDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getSession();
  const account = me!.account;
  const wallet = await serverGet<Wallet>(`/v1/wallets/${id}?accountId=${account.accountId}`);
  const balance =
    wallet.status === "ACTIVE"
      ? await serverGet<BalanceResponse>(
          `/v1/wallets/${id}/balance?accountId=${account.accountId}`,
        ).catch(() => null)
      : null;
  const setupStatus = await serverGet<SetupStatus>(
    `/v1/wallets/${id}/setup-status?accountId=${account.accountId}`,
  ).catch(() => null);
  const { policies } = await serverGet<{ policies: Policy[] }>(
    `/v1/policies?accountId=${account.accountId}`,
  );
  const walletPolicies = policies.filter((p) => p.walletId === wallet.id);
  const telegram = await serverGet<TelegramConnection>("/v1/approvals/telegram").catch(() => null);
  const isProvisioned = !!wallet.externalWalletId;

  return (
    <div className="dashboard-page space-y-6">
      <div className="dashboard-heading flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{wallet.name}</h1>
          <p className="text-sm text-muted-foreground">
            Backed by a Circle-managed wallet. Paymod holds a revocable entity authority to
            transact on this wallet's behalf, not a copy of your own signing key - there is no
            separate customer-held key under this custody model.
          </p>
        </div>
        <EditWalletButton
          accountId={account.accountId}
          walletId={wallet.id}
          name={wallet.name}
          description={wallet.description}
        />
      </div>

      {setupStatus && <WalletSetupProgress {...setupStatus} />}

      <div className="grid gap-4 lg:grid-cols-[.9fr_1.1fr]">
        <Card className="dashboard-balance-card">
          <CardHeader>
            <p className="dashboard-eyebrow">Available balance</p>
            <CardTitle>
              {balance
                ? `${formatAtomicAmount(balance.available, USDC_DECIMALS)} ${balance.assetCode}`
                : "Balance unavailable"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={wallet.status === "ACTIVE" ? "default" : "secondary"}>
              {wallet.status}
            </Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <p className="dashboard-eyebrow">Wallet identity</p>
            <CardTitle className="text-xl">Wallet details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <WalletAddress label="Chain" value={wallet.networkId ?? "Not provisioned yet"} />
            <WalletAddress label="Address" value={wallet.ownerAddress ?? "Not provisioned yet"} />
          </CardContent>
        </Card>
      </div>

      {wallet.status === "CREATING" && (
        <Card className="dashboard-action-card">
          <CardHeader>
            <p className="dashboard-eyebrow">Provisioning</p>
            <CardTitle className="text-xl">Still setting up this wallet</CardTitle>
            <CardDescription>
              Provisioning did not finish on the first request. Reload this page to retry - it is
              safe to retry as many times as needed.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {wallet.status === "ACTIVE" && isProvisioned && (
        <>
          <Card id="fund" className="dashboard-action-card scroll-mt-20">
            <CardHeader>
              <p className="dashboard-eyebrow">Add funds</p>
              <CardTitle className="text-base">Fund this wallet</CardTitle>
              <CardDescription>Send USDC directly to this wallet's own address.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FundWalletAddress address={wallet.ownerAddress ?? ""} />
            </CardContent>
          </Card>

          <Card id="connect" className="scroll-mt-20">
            <CardHeader>
              <p className="dashboard-eyebrow">Agent access</p>
              <CardTitle className="text-base">API key and connections</CardTitle>
              <CardDescription>
                Bearer credential for the agent this wallet belongs to, shown once at creation, plus
                how to hand it to an agent.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <RevealCredentialButton accountId={account.accountId} walletId={wallet.id} />
              <Separator />
              <ConnectWalletCard />
            </CardContent>
          </Card>

          <Card id="authority" className="dashboard-action-card scroll-mt-20">
            <CardHeader>
              <p className="dashboard-eyebrow">Policy authority</p>
              <CardTitle className="text-base">What can this agent spend?</CardTitle>
              <CardDescription>
                Programmable rules Paymod's policy engine checks on every transfer. This is what
                actually grants the wallet authority to spend - the underlying Circle wallet has no
                spend limits of its own configured through Paymod today.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <WalletAuthorityForm
                accountId={account.accountId}
                walletId={wallet.id}
                policies={walletPolicies}
                telegramConnected={telegram !== null}
              />
            </CardContent>
          </Card>

          <Card id="test-payment" className="scroll-mt-20">
            <CardHeader>
              <p className="dashboard-eyebrow">Verify</p>
              <CardTitle className="text-base">Test this wallet</CardTitle>
              <CardDescription>
                Sends a real transfer through Paymod&apos;s policy engine and settlement, the same
                path a connected agent uses.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TestPaymentForm accountId={account.accountId} walletId={wallet.id} />
            </CardContent>
          </Card>
        </>
      )}

      {wallet.status !== "ARCHIVED" && (
        <Card>
          <CardHeader>
            <p className="dashboard-eyebrow">Lifecycle</p>
            <CardTitle className="text-base">
              {isProvisioned ? "Close wallet" : "Discard deployment"}
            </CardTitle>
            <CardDescription>
              {isProvisioned
                ? "Closing revokes Paymod access. The underlying wallet and its funds are unaffected."
                : "This is safe to remove while the wallet has not finished provisioning."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <WalletLifecycleActions
              accountId={account.accountId}
              walletId={wallet.id}
              isProvisioned={isProvisioned}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function WalletAddress({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[5rem_minmax(0,1fr)] sm:items-center">
      <span className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="truncate font-mono text-xs" title={value}>
        {value}
      </span>
    </div>
  );
}
