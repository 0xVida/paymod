import SectionHeader from "./SectionHeader";

const FAQS = [
  {
    question: "What is a Paymod Agent Wallet?",
    answer:
      "Each agent gets its own wallet with an isolated balance and authority. A policy mistake or a compromised credential for one agent cannot reach another agent's funds.",
  },
  {
    question: "How does policy enforcement work?",
    answer:
      "Rules are deterministic: the same intent evaluated against the same active policy always produces the same decision, checked before any funds move.",
  },
  {
    question: "Does Paymod build its own wallet infrastructure?",
    answer:
      "Depends on the chain. Paymod is the policy, approval and audit layer every agent payment passes through, regardless of what runs underneath. For EVM chains that layer sits in front of Circle's Developer-Controlled Wallets; for other chains, including Stellar and Solana, Paymod builds and runs the wallet infrastructure itself. Either way, the agent never receives unrestricted signing power, only a revocable wallet credential Paymod's policy engine checks on every request.",
  },
  {
    question: "What is x402 support?",
    answer:
      "When an agent hits an x402-protected resource, Paymod evaluates the payment against that agent's wallet authority, pays when permitted and returns the resource.",
  },
  {
    question: "Is every decision auditable?",
    answer:
      "Yes. Every intent, decision, approval and execution result is written to a ledger that traces back to the authority that produced it.",
  },
  {
    question: "How do I connect my agents?",
    answer:
      "Through an MCP server, drop-in agent skills, a typed SDK or a plain REST API, whichever fits your agent's runtime.",
  },
] as const;

export default function Faq() {
  return (
    <section id="faq" className="section" aria-labelledby="faq-title">
      <SectionHeader
        num="05"
        title="Frequently asked questions"
        eyebrow="FAQ"
        marker="hollow-circle"
        titleId="faq-title"
      />

      <div className="faq-list">
        {FAQS.map((item) => (
          <details key={item.question} className="faq-item">
            <summary className="faq-question">
              <span>{item.question}</span>
              <span className="faq-question-icon" aria-hidden="true" />
            </summary>
            <p className="faq-answer">{item.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
