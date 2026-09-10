import type { ReactNode } from "react";
import Link from "next/link";
import Logo from "@/components/site/Logo";

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="auth-shell">
      <section className="auth-story">
        <Link href="/" className="auth-brand">
          <Logo size={30} variant="dark" />
          <span>Paymod</span>
        </Link>
        <div className="auth-message">
          <h1>Give agents money. Keep the authority.</h1>
          <p>
            Isolated wallets, deterministic spending policy and human approval without handing an
            agent an unrestricted signing key.
          </p>
        </div>
        <div className="auth-proof">
          <div>
            <strong>Isolated</strong>
            <span>One wallet per agent</span>
          </div>
          <div>
            <strong>Governed</strong>
            <span>Policy before execution</span>
          </div>
          <div>
            <strong>Auditable</strong>
            <span>Every decision recorded</span>
          </div>
        </div>
      </section>
      <section className="auth-form-panel">{children}</section>
    </main>
  );
}
