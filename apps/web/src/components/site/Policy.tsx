"use client";

import { useState } from "react";
import { DEFAULT_RULE_ID, RULES, TESTS, type RuleId } from "@/lib/data";
import SectionHeader from "./SectionHeader";
import VerdictBadge from "./VerdictBadge";

export default function Policy() {
  const [selectedRuleId, setSelectedRuleId] = useState<RuleId>(DEFAULT_RULE_ID);
  const test = TESTS[selectedRuleId];

  return (
    <section id="policy" className="section tall" aria-labelledby="policy-title">
      <SectionHeader
        num="01"
        title="Rules you can read out loud"
        eyebrow="Policy"
        marker="hollow-circle"
        titleId="policy-title"
      />

      <div className="split">
        <div className="policy-col">
          <div className="policy-list">
            {RULES.map((rule) => (
              <button
                key={rule.id}
                type="button"
                className="rule-button"
                aria-pressed={rule.id === selectedRuleId}
                onClick={() => setSelectedRuleId(rule.id)}
              >
                <span className="rule-left">
                  <span className="rule-dot" aria-hidden="true" />
                  <span className="rule-label">{rule.label}</span>
                </span>
                <span className="rule-right">
                  <span className="rule-value mono">{rule.value}</span>
                  <span className="rule-arrow" aria-hidden="true">
                    ↗
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="sim-col">
          <div className="sim-wrap">
            <div className="sim-card" aria-live="polite">
              <span className="sim-pin" aria-hidden="true" />
              <div className="sim-eyebrow mono">Policy Eval</div>
              <div className="sim-row">
                <span className="sim-agent mono">ops-agent</span>
                <VerdictBadge verdict={test.verdict} muted />
              </div>
              <div className="sim-amount mono">{test.amount}</div>
              <p className="sim-why">{test.why}</p>
              <div className="sim-foot">
                <span className="sim-foot-key mono">clause</span>
                <span className="sim-foot-val mono">{selectedRuleId}</span>
              </div>
            </div>
          </div>
          <p className="sim-caption">
            Deterministic by design. Same intent, same active policy, same decision.
          </p>
        </div>
      </div>
    </section>
  );
}
