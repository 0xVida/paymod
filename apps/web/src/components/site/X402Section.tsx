import { PlateStack } from "./ornaments";

const FLOW_STEPS = [
  "Agent requests resource",
  "402 Payment Required",
  "Paymod evaluates",
  "Allow / Approval / Deny",
  "Pay and retry",
  "Resource returned",
] as const;

export default function X402Section() {
  return (
    <section id="x402" className="board board-layer-3" aria-label="Agents can pay the open web">
      <div className="board-row">
        <div className="board-col">
          <span className="eyebrow mono board-section-eyebrow">x402</span>
          <h2 className="board-section-title">Agents can pay the open web.</h2>
          <p className="board-section-body">
            When an agent encounters an x402-protected resource, Paymod evaluates the payment
            against its wallet authority, pays when permitted and returns the resource, without
            ever handing the agent unrestricted signing power.
          </p>

          <ol className="x402-flow mono">
            {FLOW_STEPS.map((step, index) => (
              <li key={step} className="x402-flow-step">
                <span className="x402-flow-index">{String(index + 1).padStart(2, "0")}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>

        <PlateStack className="board-plate board-plate-tall" />
      </div>
    </section>
  );
}
