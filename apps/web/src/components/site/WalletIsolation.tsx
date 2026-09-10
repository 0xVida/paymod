import { PlateAperture } from "./ornaments";

const WALLETS = [
  { name: "Research Agent", balance: "20 USDC" },
  { name: "Deployment Agent", balance: "100 USDC" },
  { name: "Trading Agent", balance: "500 USDC" },
] as const;

export default function WalletIsolation() {
  return (
    <section id="wallets" className="board" aria-label="One agent, one financial boundary">
      <div className="board-row">
        <div className="board-col">
          <span className="eyebrow mono board-section-eyebrow">Wallet isolation</span>
          <h2 className="board-section-title">One agent. One financial boundary.</h2>
          <p className="board-section-body">
            Each Paymod Agent Wallet has its own isolated balance and authority. A policy mistake
            or a compromised credential for one agent should not expose another agent&apos;s funds.

            Policy limits what the agent is allowed to spend. Wallet isolation limits what it can
            physically reach.
          </p>

          <div className="wallet-tree">
            {WALLETS.map((wallet) => (
              <div key={wallet.name} className="wallet-branch">
                <div className="wallet-branch-head">
                  <span className="wallet-branch-name mono">{wallet.name}</span>
                  <span className="wallet-branch-balance mono">{wallet.balance}</span>
                </div>
                <span className="wallet-branch-connector" aria-hidden="true" />
                <ul className="wallet-branch-list mono">
                  <li>its wallet</li>
                  <li>its rules</li>
                  <li>its credentials</li>
                </ul>
              </div>
            ))}
          </div>
        </div>

        <PlateAperture className="board-plate" />
      </div>
    </section>
  );
}
