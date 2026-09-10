import { getSession } from "@/lib/session";
import { DeviceApprovalCard } from "@/components/dashboard/device-approval-card";

export default async function ActivateCodePage({
  searchParams,
}: {
  searchParams: Promise<{ user_code?: string }>;
}) {
  const me = await getSession();
  const account = me!.account;
  const { user_code } = await searchParams;

  return (
    <div className="dashboard-page max-w-md space-y-6">
      <div className="dashboard-heading">
        <h1 className="text-2xl font-semibold tracking-tight">Connect Paymod Code</h1>
        <p className="text-sm text-muted-foreground">
          Confirm the code shown in your editor to link it to {account.accountName}.
        </p>
      </div>
      <DeviceApprovalCard accountName={account.accountName} initialUserCode={user_code ?? ""} />
    </div>
  );
}
