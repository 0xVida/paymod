"use client";

import { scrollToId } from "@/lib/scroll";
import Logo from "./Logo";

const COLS: [string, [string, string][]][] = [
  [
    "Product",
    [
      ["Agent Wallets", "#wallets"],
      ["Policy", "#policy"],
      ["x402", "#x402"],
      ["Paymod Code", "#code"],
    ],
  ],
  [
    "Developers",
    [
      ["Docs", "/docs"],
      ["MCP", "#surfaces"],
      ["SDK", "#surfaces"],
      ["GitHub", "https://github.com/paymoderator"],
    ],
  ],
  [
    "Company",
    [
      ["Security", "#"],
      ["Contact", "#"],
    ],
  ],
];

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="site-footer-top">
        <div className="site-footer-pitch">
          <div className="site-footer-heading-row">
            <h2 className="site-footer-h2 pc-display">
              Let it spend.
              <br />
              <span className="site-footer-muted">Only this far.</span>
            </h2>
            <Logo size={56} />
          </div>
        </div>

        <div className="site-footer-cols">
          {COLS.map(([title, links]) => (
            <div key={title} className="site-footer-col">
              <div className="site-footer-col-title pc-label">{title}</div>
              <ul>
                {links.map(([label, href]) => (
                  <li key={label}>
                    <a
                      href={href}
                      onClick={(event) => {
                        if (href.length > 1 && href.startsWith("#")) {
                          event.preventDefault();
                          scrollToId(href.slice(1));
                        }
                      }}
                    >
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className="site-footer-bottom pc-label">
        <span>© 2026 Paymod</span>
        <span>the pay moderator for autonomous software</span>
      </div>
    </footer>
  );
}
