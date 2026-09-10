export const CARDS = [
  {
    tag: "MCP",
    title: "Model Context Protocol server",
    body: "Give any MCP-capable agent Paymod payment tools without exposing wallet signing authority.",
    snippet: "url: mcp.paymod.xyz",
  },
  {
    tag: "SKILLS",
    title: "Drop-in agent skills",
    body: "Prewritten skills for pay, quote, refund and balance checks.",
    snippet: "skills/pay-x402.md",
  },
  {
    tag: "SDK",
    title: "Typed client for your own runtime",
    body: "Submit a financial intent, receive the authorization decision and track execution through one typed client.",
    snippet: "await paymod.pay({...})",
  },
  {
    tag: "REST",
    title: "Anything else that speaks HTTP",
    body: "Sign a request, get a decision. Webhooks stream every state change back.",
    snippet: "POST /v1/intents",
  },
] as const;

export const RULES = [
  { id: "cap", label: "Per-call cap", value: "1.00 USDC" },
  { id: "daily", label: "Daily budget", value: "50.00 USDC" },
  { id: "threshold", label: "Approval above", value: "100.00 USDC" },
  { id: "vendors", label: "Vendor allowlist", value: "12 entries" },
  { id: "network", label: "Network", value: "mainnet only" },
  { id: "hours", label: "Active window", value: "mon–fri 08–20 UTC" },
] as const;

export type RuleId = (typeof RULES)[number]["id"];

export const TESTS = {
  cap: { amount: "0.42 USDC", verdict: "ALLOW", why: "below per-call cap" },
  daily: { amount: "48.90 USDC", verdict: "REQUIRE_APPROVAL", why: "would exhaust daily budget" },
  threshold: { amount: "180.00 USDC", verdict: "REQUIRE_APPROVAL", why: "approver ping sent" },
  vendors: { amount: "9.00 USDC", verdict: "DENY", why: "counterparty not allowlisted" },
  network: { amount: "5.00 USDC", verdict: "DENY", why: "wrong network for this treasury" },
  hours: { amount: "3.20 USDC", verdict: "REQUIRE_APPROVAL", why: "outside active window" },
} as const satisfies Record<RuleId, { amount: string; verdict: string; why: string }>;

export const LEDGER_ROWS = [
  {
    id: "10,482",
    time: "09:41:02",
    agent: "ops-agent",
    action: "transfer · base",
    usdc: "180.00",
    verdict: "APPROVED",
    authority: "@mara",
  },
  {
    id: "10,481",
    time: "09:40:55",
    agent: "research-agent",
    action: "x402 · serpstack",
    usdc: "0.42",
    verdict: "ALLOW",
    authority: "policy v12",
  },
  {
    id: "10,480",
    time: "09:38:11",
    agent: "growth-agent",
    action: "x402 · ads.exchange",
    usdc: "12.50",
    verdict: "ALLOW",
    authority: "policy v12",
  },
  {
    id: "10,479",
    time: "09:36:47",
    agent: "unknown-agent",
    action: "transfer · anon",
    usdc: "2,400.00",
    verdict: "DENY",
    authority: "no permission",
  },
  {
    id: "10,478",
    time: "09:31:20",
    agent: "research-agent",
    action: "x402 · openrouter",
    usdc: "0.08",
    verdict: "ALLOW",
    authority: "policy v12",
  },
  {
    id: "10,477",
    time: "09:22:04",
    agent: "ops-agent",
    action: "refund · stellar",
    usdc: "40.00",
    verdict: "APPROVED",
    authority: "@dre",
  },
] as const;

export type Verdict = (typeof TESTS)[RuleId]["verdict"] | (typeof LEDGER_ROWS)[number]["verdict"];

export const DEFAULT_RULE_ID: RuleId = "threshold";
