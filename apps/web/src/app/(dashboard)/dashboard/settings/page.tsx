import Link from "next/link";
import { getSession } from "@/lib/session";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CopyUrlRow } from "@/components/dashboard/copy-url-row";
import { TelegramApprovalCard } from "@/components/dashboard/telegram-approval-card";
import { McpConnectionsCard } from "@/components/dashboard/mcp-connections-card";

const AGENT_DOCS = [
  {
    label: "Skill",
    path: "/SKILL.md",
    description: "Compact, tool-call-shaped reference for an agent to read directly.",
  },
  {
    label: "Onboarding",
    path: "/ONBOARDING.md",
    description: "Human setup walkthrough: signup through first payment.",
  },
  {
    label: "Quickstart",
    path: "/QUICKSTART.md",
    description: "Fastest path from API key to a moved payment.",
  },
  {
    label: "API guide",
    path: "/API_GUIDE.md",
    description: "Full REST endpoint and error code reference.",
  },
];

export default async function SettingsPage() {
  const me = await getSession();
  const account = me!.account;

  return (
    <div className="dashboard-page space-y-6">
      <div className="dashboard-heading">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Account details and the docs to hand your agent.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p>
            <span className="text-muted-foreground">Name:</span> {account.accountName}
          </p>
          <p>
            <span className="text-muted-foreground">Signed in as:</span> {me!.user.email}
          </p>
        </CardContent>
      </Card>

      <TelegramApprovalCard />

      <McpConnectionsCard />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">API keys</CardTitle>
          <CardDescription>
            An API key (a credential, in Paymod&apos;s terms) belongs to an agent wallet. Create a
            wallet, then generate its credential from the same row. It is shown once, at creation
            and cannot be retrieved again after you navigate away.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/dashboard/wallets">Go to Wallets to create a key</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Docs for your agent</CardTitle>
          <CardDescription>
            Raw markdown, meant to be fetched directly rather than read as a web page.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {AGENT_DOCS.map((doc) => (
            <div key={doc.path} className="space-y-1">
              <CopyUrlRow label={doc.label} path={doc.path} />
              <p className="pl-[8.5rem] text-xs text-muted-foreground">{doc.description}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
