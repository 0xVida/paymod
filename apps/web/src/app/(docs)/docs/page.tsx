import Link from "next/link";

const ENTRY_POINTS = [
  {
    label: "Start with the model",
    description: "Understand the boundaries before touching the API.",
    links: [
      ["Agent Wallets", "/docs/concepts/agent-wallets"],
      ["Financial Intents", "/docs/concepts/financial-intents"],
      ["Policy and decisions", "/docs/concepts/policy"],
    ],
  },
  {
    label: "Follow a payment",
    description: "See how authority becomes a settled transaction.",
    links: [
      ["Transaction lifecycle", "/docs/execution/transaction-lifecycle"],
      ["Human approvals", "/docs/concepts/approvals"],
      ["Circle execution", "/docs/execution/circle"],
    ],
  },
  {
    label: "Connect an agent",
    description: "Choose the integration surface that fits your runtime.",
    links: [
      ["MCP", "/docs/integrations/mcp"],
      ["TypeScript SDK", "/docs/integrations/sdk"],
      ["REST API", "/docs/integrations/rest"],
    ],
  },
  {
    label: "Build the first wallet",
    description: "Go from account creation to a policy-governed payment.",
    links: [
      ["Create an Agent Wallet", "/docs/guides/create-agent-wallet"],
      ["Configure policy", "/docs/guides/configure-policy"],
      ["Make a payment", "/docs/guides/make-payment"],
    ],
  },
] as const;

const IMPLEMENTATION = [
  ["Agent Wallets", "Live"],
  ["Circle-backed settlement", "Live"],
  ["Policy engine", "Live"],
  ["Telegram transfer approvals", "Live"],
  ["Settlement reconciler", "Live"],
  ["Paymod Code usage billing", "Live"],
  ["x402 approval resumption", "Partial"],
  ["Stellar, Solana and other rails", "Planned"],
] as const;

export default function DocsPage() {
  return (
    <div className="docs-home">
      <header className="docs-home-hero">
        <p className="docs-home-kicker">Paymod Documentation</p>
        <h1>Give agents money. Keep the authority.</h1>
        <p className="docs-home-lede">
          Isolated Agent Wallets and programmable spending authority without unrestricted access to
          customer funds.
        </p>
      </header>

      <section className="docs-model" aria-label="Paymod authorization model">
        {[
          ["01", "Agent", "Requests an action"],
          ["02", "Intent", "Structures the payment"],
          ["03", "Policy", "Allows, escalates or denies"],
          ["04", "Execution", "Moves approved funds"],
        ].map(([number, title, detail], index) => (
          <div key={title} className="docs-model-step">
            <span>{number}</span>
            <strong>{title}</strong>
            <small>{detail}</small>
            {index < 3 ? <i aria-hidden="true">→</i> : null}
          </div>
        ))}
      </section>

      <section className="docs-entry-grid" aria-labelledby="explore-docs">
        <div className="docs-section-heading">
          <p>Explore Paymod</p>
        </div>
        <div className="docs-entry-cards">
          {ENTRY_POINTS.map((entry, index) => (
            <article key={entry.label} className="docs-entry-card">
              <span className="docs-entry-number">{String(index + 1).padStart(2, "0")}</span>
              <h3>{entry.label}</h3>
              <p>{entry.description}</p>
              <div>
                {entry.links.map(([label, href]) => (
                  <Link key={href} href={href}>
                    {label}
                    <span aria-hidden="true">↗</span>
                  </Link>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="docs-current" aria-labelledby="current-status">
        <div className="docs-current-copy">
          <p style={{ height: "244px" }}></p>
          <Link href="/docs/current-implementation">See the complete implementation matrix →</Link>
        </div>
        <div className="docs-current-list">
          {IMPLEMENTATION.map(([capability, status]) => (
            <div key={capability}>
              <span>{capability}</span>
              <strong data-status={status.toLowerCase()}>{status}</strong>
            </div>
          ))}
        </div>
      </section>

      <footer className="docs-home-footer">
        <p>Giving an agent access?</p>
        <div>
          <a href="/SKILL.md">Agent skill</a>
          <a href="/QUICKSTART.md">Quickstart</a>
          <a href="/API_GUIDE.md">API guide</a>
        </div>
      </footer>
    </div>
  );
}
