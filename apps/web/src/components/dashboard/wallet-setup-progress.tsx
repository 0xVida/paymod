import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Props = {
  deployed: boolean;
  funded: boolean;
  hasAuthority: boolean;
  hasCredential: boolean;
  hasCompletedPayment: boolean;
};

export function WalletSetupProgress({
  deployed,
  funded,
  hasAuthority,
  hasCredential,
  hasCompletedPayment,
}: Props) {
  const steps: {
    label: string;
    done: boolean;
    href?: string;
    ctaLabel?: string;
    blocked?: boolean;
  }[] = [
    { label: "Wallet deployed", done: deployed },
    { label: "Wallet funded", done: funded, href: "#fund", ctaLabel: "Fund" },
    {
      label: "Spending authority configured",
      done: hasAuthority,
      href: "#authority",
      ctaLabel: "Configure authority",
      blocked: true,
    },
    { label: "Agent connected", done: hasCredential, href: "#connect", ctaLabel: "Get API key" },
    {
      label: "Test payment completed",
      done: hasCompletedPayment,
      href: "#test-payment",
      ctaLabel: "Run test payment",
    },
  ];

  if (steps.every((step) => step.done)) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Badge variant="default">Ready</Badge>
        <span>This wallet is fully set up and can spend.</span>
      </div>
    );
  }

  return (
    <Card className="dashboard-action-card">
      <CardHeader>
        <p className="dashboard-eyebrow">Setup</p>
        <CardTitle className="text-base">Finish setting up this wallet</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {steps.map((step) => (
          <div key={step.label} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={
                  step.done
                    ? "text-primary"
                    : step.blocked
                      ? "text-destructive"
                      : "text-muted-foreground"
                }
              >
                {step.done ? "✓" : step.blocked ? "!" : "○"}
              </span>
              <span className={step.done ? "text-muted-foreground line-through" : undefined}>
                {step.label}
              </span>
            </span>
            {!step.done && step.href && (
              <a
                href={step.href}
                className="text-xs font-medium text-primary underline underline-offset-2"
              >
                {step.ctaLabel}
              </a>
            )}
          </div>
        ))}
        {!hasAuthority && (
          <p className="border-l-2 border-destructive pl-3 text-xs leading-5 text-muted-foreground">
            This wallet cannot spend until it has its own spending-authority rule. A policy scoped
            to another wallet, or an account-wide ceiling alone, does not grant it authority.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
