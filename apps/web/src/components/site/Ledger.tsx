import { LEDGER_ROWS } from "@/lib/data";
import { verdictColor } from "@/lib/verdict";
import SectionHeader from "./SectionHeader";

const COLUMNS = [
  { key: "id", label: "Entry" },
  { key: "time", label: "Time" },
  { key: "agent", label: "Agent" },
  { key: "action", label: "Intent" },
  { key: "usdc", label: "USDC" },
  { key: "verdict", label: "Decision" },
  { key: "authority", label: "Authority" },
] as const;

export default function Ledger() {
  return (
    <section id="ledger" className="section" aria-labelledby="ledger-title">
      <SectionHeader
        num="04"
        title="Every decision leaves a record"
        eyebrow="Example Audit trail"
        marker="sage-square"
        titleId="ledger-title"
      />

      <p className="ledger-caption">
        Every intent, decision, approval and execution result can be traced back to the authority
        that produced it.
      </p>

      <div className="ledger">
        <table className="ledger-table mono">
          <caption className="sr-only">
            The six most recent policy decisions written to the Paymod audit trail.
          </caption>
          <thead>
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={col.key === "usdc" ? "ledger-usdc" : undefined}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {LEDGER_ROWS.map((row) => (
              <tr key={row.id}>
                <td className="ledger-entry">#{row.id}</td>
                <td>{row.time}</td>
                <td>{row.agent}</td>
                <td>{row.action}</td>
                <td className="ledger-usdc">{row.usdc}</td>
                <td style={{ color: verdictColor(row.verdict) }}>
                  {row.verdict.replace(/_/g, " ")}
                </td>
                <td className="ledger-authority">{row.authority}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {}
        <div className="ledger-stack mono">
          {LEDGER_ROWS.map((row) => (
            <div key={row.id} className="ledger-stack-row">
              <div className="ledger-stack-line">
                <span className="ledger-stack-key">Entry</span>
                <span className="ledger-stack-val ledger-entry">#{row.id}</span>
              </div>
              <div className="ledger-stack-line">
                <span className="ledger-stack-key">Time</span>
                <span className="ledger-stack-val">{row.time}</span>
              </div>
              <div className="ledger-stack-line">
                <span className="ledger-stack-key">Agent</span>
                <span className="ledger-stack-val">{row.agent}</span>
              </div>
              <div className="ledger-stack-line">
                <span className="ledger-stack-key">Intent</span>
                <span className="ledger-stack-val">{row.action}</span>
              </div>
              <div className="ledger-stack-line">
                <span className="ledger-stack-key">USDC</span>
                <span className="ledger-stack-val ledger-usdc">{row.usdc}</span>
              </div>
              <div className="ledger-stack-line">
                <span className="ledger-stack-key">Decision</span>
                <span className="ledger-stack-val" style={{ color: verdictColor(row.verdict) }}>
                  {row.verdict.replace(/_/g, " ")}
                </span>
              </div>
              <div className="ledger-stack-line">
                <span className="ledger-stack-key">Authority</span>
                <span className="ledger-stack-val ledger-authority">{row.authority}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
