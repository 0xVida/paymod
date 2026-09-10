"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import Logo from "@/components/site/Logo";
import { api } from "@/lib/api";
import type { MeResponse } from "@/lib/session";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Overview", number: "01" },
  { href: "/dashboard/wallets", label: "Agent Wallets", number: "02" },
  { href: "/dashboard/policies", label: "Policies", number: "03" },
  { href: "/dashboard/code/balance", label: "Paymod Code", number: "04" },
  { href: "/dashboard/activity", label: "Activity", number: "05" },
  { href: "/dashboard/settings", label: "Settings", number: "06" },
] as const;

const ADMIN_NAV_ITEM = { href: "/dashboard/admin", label: "Admin", number: "07" } as const;

function NavLinks({
  pathname,
  isAdmin,
  onNavigate,
}: {
  pathname: string;
  isAdmin: boolean;
  onNavigate?: () => void;
}) {
  const items = isAdmin ? [...NAV_ITEMS, ADMIN_NAV_ITEM] : NAV_ITEMS;
  return (
    <nav className="dashboard-nav flex flex-1 flex-col">
      {items.map((item) => {
        const active =
          pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
        return (
          <Link
            key={item.href}
            href={item.href}
            {...(onNavigate ? { onClick: onNavigate } : {})}
            className={cn("dashboard-nav-link", active && "dashboard-nav-link-active")}
          >
            <span className="dashboard-nav-number">{item.number}</span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function AccountHeader({ me }: { me: MeResponse }) {
  return (
    <div className="dashboard-account">
      <div className="dashboard-brand">
        <Logo size={25} />
        <span>Paymod</span>
      </div>
      <div className="dashboard-account-name">{me.account.accountName}</div>
    </div>
  );
}

function AccountFooter({ me, onLogout }: { me: MeResponse; onLogout: () => void }) {
  return (
    <div className="dashboard-footer">
      <div className="dashboard-email">{me.user.email}</div>
      <Button variant="ghost" size="sm" className="w-full justify-start px-0" onClick={onLogout}>
        Log out
      </Button>
    </div>
  );
}

export function DashboardNav({ me }: { me: MeResponse }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  async function handleLogout() {
    await api.post("/v1/auth/logout");
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      <div className="dashboard-mobile-header flex h-16 shrink-0 items-center justify-between px-4 md:hidden">
        <div className="min-w-0">
          <div className="dashboard-brand">
            <Logo size={22} />
            <span>Paymod</span>
          </div>
          <div className="truncate text-xs text-muted-foreground">{me.account.accountName}</div>
        </div>
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon" aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent
            side="left"
            className="light paymod-app dashboard-sidebar flex w-72 flex-col gap-0 p-0"
          >
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <AccountHeader me={me} />
            <NavLinks
              pathname={pathname}
              isAdmin={me.isAdmin}
              onNavigate={() => setMobileOpen(false)}
            />
            <AccountFooter me={me} onLogout={handleLogout} />
          </SheetContent>
        </Sheet>
      </div>

      <aside className="dashboard-sidebar hidden h-screen w-64 shrink-0 flex-col md:flex">
        <AccountHeader me={me} />
        <NavLinks pathname={pathname} isAdmin={me.isAdmin} />
        <AccountFooter me={me} onLogout={handleLogout} />
      </aside>
    </>
  );
}
