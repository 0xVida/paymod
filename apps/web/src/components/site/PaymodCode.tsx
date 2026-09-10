import SectionHeader from "./SectionHeader";

export default function PaymodCode() {
  return (
    <section id="code" className="section tall" aria-labelledby="code-title">
      <SectionHeader
        num="03"
        title="Meet Paymod Code"
        eyebrow="Paymod Code"
        marker="rust-square"
        titleId="code-title"
      />

      <div className="split top">
        <div className="code-col">
          <p className="code-lede-body">
            Paymod Code is a pay-as-you-go coding agent for VS Code and the terminal that reads,
            edits, runs and tests your real projects using multiple model providers, with
            transparent usage metering through Paymod.
          </p>

          <div className="terminal">
            <div className="terminal-bar">
              <span className="editor-dot editor-dot-close" aria-hidden="true" />
              <span className="editor-dot editor-dot-minimize" aria-hidden="true" />
              <span className="editor-dot editor-dot-maximize" aria-hidden="true" />
              <span className="editor-file mono">terminal</span>
            </div>
            <div className="terminal-body mono">
              <span className="terminal-prompt">$</span> npm install -g @paymod/code-cli
            </div>
          </div>

          <button type="button" className="code-install pc-label" disabled>
            Install on VS Code
          </button>
        </div>

        <div className="editor">
          <div className="editor-bar">
            <span className="editor-dot editor-dot-close" aria-hidden="true" />
            <span className="editor-dot editor-dot-minimize" aria-hidden="true" />
            <span className="editor-dot editor-dot-maximize" aria-hidden="true" />
            <span className="editor-file mono">paymod-code · checkout.ts</span>
          </div>
          <div className="editor-body mono">
            <div>
              <span className="code-gutter">1</span>
              <span className="code-plain code-indent">export async function </span>
              <span className="code-fn">checkout</span>
              <span className="code-plain">(order: Order) {"{"}</span>
            </div>
            <div>
              <span className="code-gutter">2</span>
              <span className="code-plain code-indent">{"  const total = "}</span>
              <span className="code-fn">calculateTotal</span>
              <span className="code-plain">(order.items);</span>
            </div>
            <div>
              <span className="code-gutter">3</span>
              <span className="code-plain code-indent">{"  return "}</span>
              <span className="code-fn">createPayment</span>
              <span className="code-plain">(order.customerId, total);</span>
            </div>
            <div>
              <span className="code-gutter">4</span>
              <span className="code-plain code-indent">{"}"}</span>
            </div>
            <div className="editor-spacer" />
            <div className="editor-status">✓ edited 1 file</div>
            <div className="editor-status">✓ tests passing</div>
            <div className="editor-foot">
              <span className="editor-foot-key">session cost, via Paymod</span>
              <span className="editor-foot-val">$0.0034</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
