import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { DashboardNav } from "@/components/dashboard/dashboard-nav";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const me = await getSession();
  if (!me) redirect("/login");

  return (
    <div className="dashboard-shell flex h-screen flex-col overflow-hidden md:flex-row">
      <DashboardNav me={me} />
      <main className="dashboard-main flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
