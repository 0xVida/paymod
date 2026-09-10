import { getSession } from "@/lib/session";
import { serverGet } from "@/lib/server-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DepositAddressRow } from "@/components/dashboard/deposit-address-row";

type DepositAddressResponse = { address: string; balanceUsd: number };

export default async function CodeBalancePage() {
  const me = await getSession();
  const account = me!.account;
  const { address, balanceUsd } = await serverGet<DepositAddressResponse>("/v1/code/deposit-address");

  return (
    <div className="dashboard-page max-w-md space-y-6">
      <div className="dashboard-heading">
        <h1 className="text-2xl font-semibold tracking-tight">Paymod Code balance</h1>
        <p className="text-sm text-muted-foreground">
          Fund inference for {account.accountName} in Paymod Code. No wallet connection needed.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Deposit</CardTitle>
        </CardHeader>
        <CardContent>
          <DepositAddressRow address={address} initialBalanceUsd={balanceUsd} />
        </CardContent>
      </Card>
    </div>
  );
}
