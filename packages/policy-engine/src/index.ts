import { atomicAmountSchema, parseAtomicAmount } from "@paymod/shared";
import { z } from "zod";

/**
 * Deterministic, pure policy evaluation.
 *
 * Chain-agnostic: no Stellar, no EVM, no SDK imports ever. A rule that
 * needs to know how a payment settles belongs in the rail adapter.
 *
 * The budget check here is advisory only, not authoritative: that's the
 * guarded conditional UPDATE plus Postgres's `CHECK (spent + reserved <=
 * limit)` constraint. This copy exists for a good reason code and to
 * avoid reserving budget policy would reject anyway; under concurrency
 * it sees stale numbers by construction, so never remove the database
 * check on the strength of this one.
 *
 * Period math lives outside: `budgets` arrives pre-resolved to the
 * correct calendar windows, letting daily and monthly limits apply
 * simultaneously while this function stays pure.
 */

export const DECISIONS = ["ALLOW", "DENY", "REQUIRE_APPROVAL"] as const;
export type Decision = (typeof DECISIONS)[number];

export const POLICY_TYPES = [
  "DAILY_LIMIT",
  "MONTHLY_LIMIT",
  "PER_TRANSACTION_LIMIT",
  "ASSET_ALLOWLIST",
  "ASSET_BLOCKLIST",
  "NETWORK_ALLOWLIST",
  "NETWORK_BLOCKLIST",
  "DESTINATION_ALLOWLIST",
  "DESTINATION_BLOCKLIST",
  "ACTION_ALLOWLIST",
  "ACTION_BLOCKLIST",
  "APPROVAL_THRESHOLD",
  "X402_MAX_AUTOPAY",
  "WALLET_STATUS",
] as const;
export type PolicyType = (typeof POLICY_TYPES)[number];

const limitConfig = z.object({ limitAtomic: atomicAmountSchema });
const listConfig = z.object({ values: z.array(z.string().min(1)).min(1) });

const policyConfigByType: Record<PolicyType, z.ZodTypeAny> = {
  DAILY_LIMIT: limitConfig,
  MONTHLY_LIMIT: limitConfig,
  PER_TRANSACTION_LIMIT: limitConfig,
  APPROVAL_THRESHOLD: z.object({ thresholdAtomic: atomicAmountSchema }),
  X402_MAX_AUTOPAY: z.object({ maxAutopayAtomic: atomicAmountSchema }),
  ASSET_ALLOWLIST: listConfig,
  ASSET_BLOCKLIST: listConfig,
  NETWORK_ALLOWLIST: listConfig,
  NETWORK_BLOCKLIST: listConfig,
  DESTINATION_ALLOWLIST: listConfig,
  DESTINATION_BLOCKLIST: listConfig,
  ACTION_ALLOWLIST: listConfig,
  ACTION_BLOCKLIST: listConfig,
  // retained for spec conformance only. Wallet status is a fixed precedence
  // stage, not a rule the operator can reorder: see stage 2 below.
  WALLET_STATUS: z.object({}).passthrough(),
};

export const policyRuleSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(POLICY_TYPES),
    /**
     * `null` = applies account-wide. Per ADR 0010, an account-wide rule
     * only narrows a wallet's authority, never grants it - which is why
     * `checkSpendingAuthority` below deliberately uses
     * `hasWalletScopedPolicy` instead of `resolveScoped`, the one stage
     * that must not fall back to an account-wide rule.
     */
    walletId: z.string().min(1).nullable(),
    priority: z.number().int().default(0),
    enabled: z.boolean().default(true),
    config: z.unknown(),
  })
  .superRefine((rule, ctx) => {
    const result = policyConfigByType[rule.type].safeParse(rule.config);
    if (!result.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["config"],
        message: `Invalid config for ${rule.type}: ${result.error.message}`,
      });
    }
  });

export type PolicyRule = z.infer<typeof policyRuleSchema>;

export const evaluationContextSchema = z.object({
  account: z.object({
    id: z.string().min(1),
    status: z.enum(["ACTIVE", "SUSPENDED"]),
  }),
  /**
   * ADR 0010 folds a Spender's permission-handle status and a Treasury's
   * contract status into one, since an AgentWallet's contract identity
   * and spending identity are now the same thing. Only ACTIVE may
   * proceed; the contract's own `paused` flag is a separate concept
   * checked at settlement time.
   */
  wallet: z.object({
    id: z.string().min(1),
    status: z.enum(["CREATING", "AWAITING_SIGNATURE", "ACTIVE", "ARCHIVED"]),
  }),
  intent: z.object({
    type: z.enum(["TRANSFER", "X402_PAYMENT"]),
    atomicAmount: atomicAmountSchema,
    assetCode: z.string().min(1).toUpperCase(),
    networkId: z.string().min(1),
    destination: z.string().min(1),
    action: z.string().min(1).optional(),
  }),
  /**
   * Observed spend for each already-resolved window. Limits come from the
   * policy rules, not from here, so there is exactly one source of truth for
   * a limit. A window with no row yet is simply absent (nothing spent).
   */
  budgets: z
    .array(
      z.object({
        window: z.enum(["DAY", "MONTH"]),
        spentAtomic: atomicAmountSchema,
        reservedAtomic: atomicAmountSchema,
      }),
    )
    .default([]),
  policies: z.array(policyRuleSchema).default([]),
});

/** post-parse shape, with every default resolved. */
export type EvaluationContext = z.infer<typeof evaluationContextSchema>;

/**
 * Pre-parse shape: what a caller actually constructs, with defaulted fields
 * optional. `evaluatePolicy` takes `unknown` on purpose so that untrusted input
 * is validated at the boundary rather than trusted through a cast; this type is
 * for callers that build the context in TypeScript and want it checked.
 */
export type EvaluationContextInput = z.input<typeof evaluationContextSchema>;

export type TraceEntry = {
  stage: string;
  outcome: "pass" | "match" | "skip";
  policyId?: string;
};

export type PolicyEvaluation = {
  decision: Decision;
  /** stable machine code. Surfaces to agents and the audit log. */
  reason: string;
  matchedPolicyIds: string[];
  trace: TraceEntry[];
};

/**
 * Scope resolution for non-blocklist rules: a per-wallet rule *replaces* the
 * account-wide rule of the same type. This is what permits the common
 * "wallet X gets a higher limit than the default" case, which a naive
 * most-restrictive-wins rule would make impossible to express.
 *
 * Ties among rules at the same scope are broken by `priority` (highest wins),
 * then by taking the most restrictive value, so evaluation stays deterministic
 * regardless of row order.
 */
function resolveScoped(policies: PolicyRule[], type: PolicyType, walletId: string): PolicyRule[] {
  const candidates = policies.filter((p) => p.enabled && p.type === type);
  const scoped = candidates.filter((p) => p.walletId === walletId);
  const pool = scoped.length > 0 ? scoped : candidates.filter((p) => p.walletId === null);
  if (pool.length === 0) return [];
  const topPriority = Math.max(...pool.map((p) => p.priority));
  return pool.filter((p) => p.priority === topPriority);
}

/**
 * wallet-scoped only, no account-wide fallback. Used exclusively by
 * `checkSpendingAuthority`: see `policyRuleSchema`'s `walletId` docblock for
 * why this must stay a distinct function from `resolveScoped` rather than
 * being merged into it.
 */
function hasWalletScopedPolicy(policies: PolicyRule[], type: PolicyType, walletId: string): boolean {
  return policies.some((p) => p.enabled && p.type === type && p.walletId === walletId);
}

/** blocklists union across every scope and can never be overridden. */
function resolveBlocklist(policies: PolicyRule[], type: PolicyType, walletId: string) {
  const rules = policies.filter(
    (p) => p.enabled && p.type === type && (p.walletId === null || p.walletId === walletId),
  );
  const values = new Set<string>();
  for (const rule of rules) {
    for (const value of (rule.config as { values: string[] }).values) values.add(value);
  }
  return { rules, values };
}

function mostRestrictiveLimit(rules: PolicyRule[], key: string): { rule: PolicyRule; value: bigint } | undefined {
  let winner: { rule: PolicyRule; value: bigint } | undefined;
  for (const rule of rules) {
    const raw = (rule.config as Record<string, string>)[key]!;
    const value = parseAtomicAmount(raw);
    if (winner === undefined || value < winner.value) winner = { rule, value };
  }
  return winner;
}

/** intersection, so a tie between two allowlists can't widen access. */
function intersectAllowlist(rules: PolicyRule[]): { rules: PolicyRule[]; values: Set<string> } {
  let values: Set<string> | undefined;
  for (const rule of rules) {
    const next = new Set((rule.config as { values: string[] }).values);
    values = values === undefined ? next : new Set([...values].filter((v) => next.has(v)));
  }
  return { rules, values: values ?? new Set<string>() };
}

/** bundles what every stage needs so each stage function takes one argument. */
type StageContext = {
  account: EvaluationContext["account"];
  wallet: EvaluationContext["wallet"];
  intent: EvaluationContext["intent"];
  budgets: EvaluationContext["budgets"];
  policies: PolicyRule[];
  amount: bigint;
  trace: TraceEntry[];
};

/** `undefined` means the stage passed; the ladder continues to the next one. */
type StageResult = PolicyEvaluation | undefined;

function recordDeny(trace: TraceEntry[], stage: string, reason: string, policyIds: string[] = []): PolicyEvaluation {
  trace.push({ stage, outcome: "match", ...(policyIds[0] !== undefined && { policyId: policyIds[0] }) });
  return { decision: "DENY", reason, matchedPolicyIds: policyIds, trace };
}

function recordRequireApproval(trace: TraceEntry[], stage: string, reason: string, policyId: string): PolicyEvaluation {
  trace.push({ stage, outcome: "match", policyId });
  return { decision: "REQUIRE_APPROVAL", reason, matchedPolicyIds: [policyId], trace };
}

function recordPass(trace: TraceEntry[], stage: string): void {
  trace.push({ stage, outcome: "pass" });
}

function recordSkip(trace: TraceEntry[], stage: string): void {
  trace.push({ stage, outcome: "skip" });
}

function checkAccountStatus(ctx: StageContext): StageResult {
  if (ctx.account.status === "SUSPENDED") return recordDeny(ctx.trace, "account_status", "ACCOUNT_SUSPENDED");
  recordPass(ctx.trace, "account_status");
}

/**
 * built in, never a policy rule the operator can reorder. One status now
 * covers both a wallet's permission-handle status and its contract's
 * readiness (ADR 0010). Only ACTIVE may proceed.
 */
function checkWalletStatus(ctx: StageContext): StageResult {
  if (ctx.wallet.status === "ARCHIVED") return recordDeny(ctx.trace, "wallet_status", "WALLET_ARCHIVED");
  if (ctx.wallet.status !== "ACTIVE") return recordDeny(ctx.trace, "wallet_status", "WALLET_NOT_READY");
  recordPass(ctx.trace, "wallet_status");
}

/**
 * Default-deny gate. Absence of one specific optional policy (an
 * allowlist, an approval threshold) must not itself deny, but absence of
 * any wallet-scoped budget-establishing policy means this wallet was
 * never granted spending authority at all - fails closed, not open.
 *
 * Deliberately uses `hasWalletScopedPolicy`, not `resolveScoped`: an
 * account-wide budget rule alone must never satisfy this gate, only
 * narrow a wallet's authority once it has its own. See
 * `policyRuleSchema`'s `walletId` docblock.
 */
function checkSpendingAuthority(ctx: StageContext): StageResult {
  const { policies, wallet, trace } = ctx;
  const hasAuthority = (["DAILY_LIMIT", "MONTHLY_LIMIT", "PER_TRANSACTION_LIMIT"] as const).some((type) =>
    hasWalletScopedPolicy(policies, type, wallet.id),
  );
  if (!hasAuthority) return recordDeny(trace, "spending_authority", "NO_SPENDING_POLICY");
  recordPass(trace, "spending_authority");
}

/** never overridable: checked ahead of every limit and allowlist. */
function checkBlocklists(ctx: StageContext): StageResult {
  const { intent, policies, wallet, trace } = ctx;
  const checks = [
    { type: "DESTINATION_BLOCKLIST" as const, value: intent.destination, reason: "DESTINATION_BLOCKED" },
    { type: "ASSET_BLOCKLIST" as const, value: intent.assetCode, reason: "ASSET_BLOCKED" },
    { type: "NETWORK_BLOCKLIST" as const, value: intent.networkId, reason: "NETWORK_BLOCKED" },
    { type: "ACTION_BLOCKLIST" as const, value: intent.action, reason: "ACTION_BLOCKED" },
  ];
  for (const check of checks) {
    if (check.value === undefined) continue;
    const { rules, values } = resolveBlocklist(policies, check.type, wallet.id);
    if (values.has(check.value)) {
      const matched = rules.filter((r) => (r.config as { values: string[] }).values.includes(check.value!));
      return recordDeny(trace, "blocklist", check.reason, matched.map((r) => r.id));
    }
  }
  recordPass(trace, "blocklist");
}

/** DAY checked before MONTH: the order the caller must reserve budget in too. */
function checkBudgets(ctx: StageContext): StageResult {
  const { policies, wallet, budgets, amount, trace } = ctx;
  const checks = [
    { window: "DAY" as const, type: "DAILY_LIMIT" as const, reason: "DAILY_LIMIT_EXCEEDED" },
    { window: "MONTH" as const, type: "MONTHLY_LIMIT" as const, reason: "MONTHLY_LIMIT_EXCEEDED" },
  ];
  for (const check of checks) {
    const rules = resolveScoped(policies, check.type, wallet.id);
    if (rules.length === 0) continue;
    const limit = mostRestrictiveLimit(rules, "limitAtomic")!;
    const budget = budgets.find((b) => b.window === check.window);
    const committed = budget
      ? parseAtomicAmount(budget.spentAtomic) + parseAtomicAmount(budget.reservedAtomic)
      : 0n;
    if (committed + amount > limit.value) return recordDeny(trace, "budget", check.reason, [limit.rule.id]);
  }
  recordPass(trace, "budget");
}

function checkPerTransactionLimit(ctx: StageContext): StageResult {
  const { policies, wallet, amount, trace } = ctx;
  const rules = resolveScoped(policies, "PER_TRANSACTION_LIMIT", wallet.id);
  if (rules.length === 0) return void recordSkip(trace, "per_transaction");
  const limit = mostRestrictiveLimit(rules, "limitAtomic")!;
  if (amount > limit.value) {
    return recordDeny(trace, "per_transaction", "PER_TRANSACTION_LIMIT_EXCEEDED", [limit.rule.id]);
  }
  recordPass(trace, "per_transaction");
}

/** only enforced when configured: an absent allowlist leaves a dimension unrestricted. */
function checkAllowlists(ctx: StageContext): StageResult {
  const { intent, policies, wallet, trace } = ctx;
  const checks = [
    { type: "DESTINATION_ALLOWLIST" as const, value: intent.destination, reason: "DESTINATION_NOT_ALLOWED" },
    { type: "ASSET_ALLOWLIST" as const, value: intent.assetCode, reason: "ASSET_NOT_ALLOWED" },
    { type: "NETWORK_ALLOWLIST" as const, value: intent.networkId, reason: "NETWORK_NOT_ALLOWED" },
    { type: "ACTION_ALLOWLIST" as const, value: intent.action, reason: "ACTION_NOT_ALLOWED" },
  ];
  for (const check of checks) {
    const rules = resolveScoped(policies, check.type, wallet.id);
    if (rules.length === 0) continue;
    const { values } = intersectAllowlist(rules);
    // an intent with no action can't satisfy a configured action allowlist.
    if (check.value === undefined || !values.has(check.value)) {
      return recordDeny(trace, "allowlist", check.reason, rules.map((r) => r.id));
    }
  }
  recordPass(trace, "allowlist");
}

function checkX402Autopay(ctx: StageContext): StageResult {
  const { intent, policies, wallet, amount, trace } = ctx;
  if (intent.type !== "X402_PAYMENT") return void recordSkip(trace, "x402_autopay");
  const rules = resolveScoped(policies, "X402_MAX_AUTOPAY", wallet.id);
  if (rules.length === 0) return void recordSkip(trace, "x402_autopay");
  const limit = mostRestrictiveLimit(rules, "maxAutopayAtomic")!;
  if (amount > limit.value) {
    return recordRequireApproval(trace, "x402_autopay", "X402_AUTOPAY_EXCEEDED", limit.rule.id);
  }
  recordPass(trace, "x402_autopay");
}

function checkApprovalThreshold(ctx: StageContext): StageResult {
  const { policies, wallet, amount, trace } = ctx;
  const rules = resolveScoped(policies, "APPROVAL_THRESHOLD", wallet.id);
  if (rules.length === 0) return void recordSkip(trace, "approval_threshold");
  const threshold = mostRestrictiveLimit(rules, "thresholdAtomic")!;
  // `>=` preserves the semantics of the original engine.
  if (amount >= threshold.value) {
    return recordRequireApproval(trace, "approval_threshold", "APPROVAL_REQUIRED", threshold.rule.id);
  }
  recordPass(trace, "approval_threshold");
}

/** precedence ladder, evaluated in order. The first non-pass stage decides. */
const STAGES = [
  checkAccountStatus,
  checkWalletStatus,
  checkSpendingAuthority,
  checkBlocklists,
  checkBudgets,
  checkPerTransactionLimit,
  checkAllowlists,
  checkX402Autopay,
  checkApprovalThreshold,
];

export function evaluatePolicy(raw: unknown): PolicyEvaluation {
  const parsed = evaluationContextSchema.parse(raw);
  const ctx: StageContext = {
    account: parsed.account,
    wallet: parsed.wallet,
    intent: parsed.intent,
    budgets: parsed.budgets,
    policies: parsed.policies,
    amount: parseAtomicAmount(parsed.intent.atomicAmount),
    trace: [],
  };

  for (const stage of STAGES) {
    const result = stage(ctx);
    if (result) return result;
  }

  ctx.trace.push({ stage: "allow", outcome: "pass" });
  return { decision: "ALLOW", reason: "WITHIN_POLICY", matchedPolicyIds: [], trace: ctx.trace };
}
