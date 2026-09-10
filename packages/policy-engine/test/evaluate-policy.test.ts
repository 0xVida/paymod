import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { evaluatePolicy, type EvaluationContextInput, type PolicyType } from "../src/index.ts";

let seq = 0;
function rule(type: PolicyType, config: unknown, over: { walletId?: string | null; priority?: number; enabled?: boolean } = {}) {
  return {
    id: `pol_${type}_${++seq}`,
    type,
    walletId: over.walletId ?? null,
    priority: over.priority ?? 0,
    enabled: over.enabled ?? true,
    config,
  };
}

const limit = (type: PolicyType, limitAtomic: string, over = {}) => rule(type, { limitAtomic }, over);
const list = (type: PolicyType, values: string[], over = {}) => rule(type, { values }, over);

type Ctx = EvaluationContextInput;

/**
 * every scenario below is set up as "an already-authorized wallet" since
 * it's testing something else (a blocklist, an allowlist, a priority
 * tie-break), so a generous baseline `DAILY_LIMIT` is merged into
 * `policies` by default - always looser than any scenario's own limit, so
 * `mostRestrictiveLimit` never picks it. "Spending authority gate" below
 * opts out via `noBaseline: true`.
 */
const BASELINE_AUTHORITY_ATOMIC = "99999999999999999999999999999999";

function ctx(over: Record<string, unknown> & { noBaseline?: boolean } = {}): Ctx {
  const { noBaseline, ...rest } = over;
  const suppliedPolicies = (rest["policies"] as ReturnType<typeof rule>[] | undefined) ?? [];
  const policies = noBaseline
    ? suppliedPolicies
    : [...suppliedPolicies, limit("DAILY_LIMIT", BASELINE_AUTHORITY_ATOMIC, { walletId: "wal_1" })];
  return {
    account: { id: "acc_1", status: "ACTIVE" },
    wallet: { id: "wal_1", status: "ACTIVE" },
    intent: {
      type: "TRANSFER",
      atomicAmount: "1000000",
      assetCode: "USDC",
      networkId: "stellar:testnet",
      destination: "merchant-1",
    },
    budgets: [],
    ...rest,
    policies,
  } as Ctx;
}

function expect(context: Ctx, decision: string, reason: string) {
  const result = evaluatePolicy(context);
  assert.equal(result.decision, decision, `decision (reason was ${result.reason})`);
  assert.equal(result.reason, reason);
  return result;
}

describe("The four original scenarios, preserved", () => {
  // faithful translation of the pre-rewrite `basePolicy`, now wallet-scoped.
  const legacyPolicies = [
    list("ASSET_ALLOWLIST", ["USDC"], { walletId: "wal_1" }),
    list("NETWORK_ALLOWLIST", ["stellar:testnet"], { walletId: "wal_1" }),
    list("DESTINATION_ALLOWLIST", ["merchant-1"], { walletId: "wal_1" }),
    limit("PER_TRANSACTION_LIMIT", "2000000", { walletId: "wal_1" }),
    limit("DAILY_LIMIT", "5000000", { walletId: "wal_1" }),
    rule("APPROVAL_THRESHOLD", { thresholdAtomic: "1500000" }, { walletId: "wal_1" }),
  ];
  const legacyBudgets = [{ window: "DAY", spentAtomic: "1000000", reservedAtomic: "0" }];
  const legacy = (over: Record<string, unknown> = {}) =>
    ctx({ noBaseline: true, policies: legacyPolicies, budgets: legacyBudgets, ...over });

  test("legacy: allows an intent inside every hard policy boundary", () => {
    expect(legacy(), "ALLOW", "WITHIN_POLICY");
  });

  test("legacy: denial precedence puts a wallet lifecycle denial ahead of all other outcomes", () => {
    expect(
      legacy({ wallet: { id: "wal_1", status: "ARCHIVED" }, intent: { ...ctx().intent, atomicAmount: "9000000" } }),
      "DENY",
      "WALLET_ARCHIVED",
    );
  });

  test("legacy: requires approval at the configured atomic threshold", () => {
    expect(
      legacy({ intent: { ...ctx().intent, atomicAmount: "1500000" } }),
      "REQUIRE_APPROVAL",
      "APPROVAL_REQUIRED",
    );
  });

  test("legacy: rejects an overspend without floating point arithmetic", () => {
    // behaviour change, deliberate and documented: spec §25 puts the budget stage
    // ahead of the per-transaction stage, so an amount that breaches both now
    // reports the budget reason rather than the per-payment one. The DECISION is
    // unchanged: this was DENY before and is DENY now.
    expect(
      legacy({ intent: { ...ctx().intent, atomicAmount: "4000001" } }),
      "DENY",
      "DAILY_LIMIT_EXCEEDED",
    );
    expect(
      legacy({
        policies: [...legacyPolicies.filter((p) => p.type !== "PER_TRANSACTION_LIMIT"), limit("PER_TRANSACTION_LIMIT", "5000000", { walletId: "wal_1" })],
        intent: { ...ctx().intent, atomicAmount: "4000001" },
      }),
      "DENY",
      "DAILY_LIMIT_EXCEEDED",
    );
  });

});

describe("Stage 1-2: lifecycle preconditions", () => {
  test("account suspended denies", () => {
    expect(ctx({ account: { id: "acc_1", status: "SUSPENDED" } }), "DENY", "ACCOUNT_SUSPENDED");
  });

  test("wallet archived denies", () => {
    expect(ctx({ wallet: { id: "wal_1", status: "ARCHIVED" } }), "DENY", "WALLET_ARCHIVED");
  });

  test("a wallet still mid-deployment (any non-ACTIVE, non-archived status) denies", () => {
    for (const status of ["CREATING", "AWAITING_SIGNATURE"]) {
      expect(ctx({ wallet: { id: "wal_1", status } }), "DENY", "WALLET_NOT_READY");
    }
  });

  test("account suspension outranks wallet archived", () => {
    expect(
      ctx({ account: { id: "acc_1", status: "SUSPENDED" }, wallet: { id: "wal_1", status: "ARCHIVED" } }),
      "DENY",
      "ACCOUNT_SUSPENDED",
    );
  });

});

describe("Stage 3: spending authority gate (default-deny)", () => {
  // no wallet may move funds unless it has been explicitly granted spending
  // authority. `noBaseline: true` opts these cases out of the fixture's
  // usual "already-authorized" baseline (see `ctx`'s docblock). This block
  // is the one place actually testing its absence.

  test("zero policies denies: a brand new wallet, no authority granted yet", () => {
    expect(ctx({ noBaseline: true }), "DENY", "NO_SPENDING_POLICY");
  });

  test("a disabled budget policy is the same as no policy: still denies", () => {
    expect(
      ctx({ noBaseline: true, policies: [limit("DAILY_LIMIT", "5000000", { walletId: "wal_1", enabled: false })] }),
      "DENY",
      "NO_SPENDING_POLICY",
    );
  });

  test("all relevant budget policies disabled denies, even with several configured", () => {
    expect(
      ctx({
        noBaseline: true,
        policies: [
          limit("DAILY_LIMIT", "5000000", { walletId: "wal_1", enabled: false }),
          limit("MONTHLY_LIMIT", "50000000", { walletId: "wal_1", enabled: false }),
          limit("PER_TRANSACTION_LIMIT", "1000000", { walletId: "wal_1", enabled: false }),
        ],
      }),
      "DENY",
      "NO_SPENDING_POLICY",
    );
  });

  test("a budget policy scoped to a different wallet grants no authority here", () => {
    expect(
      ctx({ noBaseline: true, policies: [limit("DAILY_LIMIT", "5000000", { walletId: "wal_other" })] }),
      "DENY",
      "NO_SPENDING_POLICY",
    );
  });

  test("an account-wide budget policy alone is not spending authority", () => {
    // the critical rule from ADR 0010's migration plan: account-wide policy
    // can restrict a wallet but can never by itself activate spending for it.
    expect(
      ctx({ noBaseline: true, policies: [limit("DAILY_LIMIT", "500000000", { walletId: null })] }),
      "DENY",
      "NO_SPENDING_POLICY",
    );
  });

  test("a non-budget policy alone (an allowlist, an approval threshold) is not spending authority", () => {
    expect(
      ctx({
        noBaseline: true,
        policies: [list("DESTINATION_ALLOWLIST", ["merchant-1"], { walletId: "wal_1" }), rule("APPROVAL_THRESHOLD", { thresholdAtomic: "1" }, { walletId: "wal_1" })],
      }),
      "DENY",
      "NO_SPENDING_POLICY",
    );
  });

  test("a MONTHLY_LIMIT alone is sufficient authority, same as DAILY_LIMIT or PER_TRANSACTION_LIMIT", () => {
    expect(ctx({ noBaseline: true, policies: [limit("MONTHLY_LIMIT", "5000000", { walletId: "wal_1" })] }), "ALLOW", "WITHIN_POLICY");
  });

  test("a PER_TRANSACTION_LIMIT alone is sufficient authority", () => {
    expect(ctx({ noBaseline: true, policies: [limit("PER_TRANSACTION_LIMIT", "5000000", { walletId: "wal_1" })] }), "ALLOW", "WITHIN_POLICY");
  });

  test("a wallet-scoped budget rule grants authority and is the one that binds, even with an account-wide rule of the same type present", () => {
    // resolveScoped's wallet-scoped-replaces-account-wide rule (not
    // "combine, most-restrictive wins"), unchanged by ADR 0010. See
    // "Scope resolution" below for the raising/lowering pair this
    // generalizes.
    expect(
      ctx({
        noBaseline: true,
        policies: [limit("DAILY_LIMIT", "5000000", { walletId: "wal_1" }), limit("DAILY_LIMIT", "1", { walletId: null })],
      }),
      "ALLOW",
      "WITHIN_POLICY",
    );
  });

  test("an enabled DAILY_LIMIT is sufficient authority even alongside disabled ones", () => {
    expect(
      ctx({
        noBaseline: true,
        policies: [limit("DAILY_LIMIT", "5000000", { walletId: "wal_1" }), limit("MONTHLY_LIMIT", "1", { walletId: "wal_1", enabled: false })],
      }),
      "ALLOW",
      "WITHIN_POLICY",
    );
  });

  test("the gate outranks every later stage: no authority denies even when nothing else would object", () => {
    expect(
      ctx({
        noBaseline: true,
        policies: [list("DESTINATION_ALLOWLIST", ["merchant-1"], { walletId: "wal_1" })],
        intent: { ...ctx().intent, atomicAmount: "1" },
      }),
      "DENY",
      "NO_SPENDING_POLICY",
    );
  });

  test("the gate is outranked by lifecycle preconditions: an account suspension is reported first", () => {
    expect(
      ctx({ noBaseline: true, account: { id: "acc_1", status: "SUSPENDED" } }),
      "DENY",
      "ACCOUNT_SUSPENDED",
    );
  });
});

describe("Stage 4: blocklists", () => {
  test("destination blocklist denies", () => {
    expect(ctx({ policies: [list("DESTINATION_BLOCKLIST", ["merchant-1"])] }), "DENY", "DESTINATION_BLOCKED");
  });

  test("asset blocklist denies", () => {
    expect(ctx({ policies: [list("ASSET_BLOCKLIST", ["USDC"])] }), "DENY", "ASSET_BLOCKED");
  });

  test("network blocklist denies", () => {
    expect(ctx({ policies: [list("NETWORK_BLOCKLIST", ["stellar:testnet"])] }), "DENY", "NETWORK_BLOCKED");
  });

  test("action blocklist denies", () => {
    expect(
      ctx({
        intent: { ...ctx().intent, action: "HTTP_RESOURCE_PURCHASE" },
        policies: [list("ACTION_BLOCKLIST", ["HTTP_RESOURCE_PURCHASE"])],
      }),
      "DENY",
      "ACTION_BLOCKED",
    );
  });

  test("action blocklist is inert when the intent carries no action", () => {
    expect(ctx({ policies: [list("ACTION_BLOCKLIST", ["ANYTHING"])] }), "ALLOW", "WITHIN_POLICY");
  });

  test("a blocklist outranks every limit", () => {
    expect(
      ctx({
        policies: [list("DESTINATION_BLOCKLIST", ["merchant-1"]), limit("PER_TRANSACTION_LIMIT", "1", { walletId: "wal_1" })],
      }),
      "DENY",
      "DESTINATION_BLOCKED",
    );
  });

  test("a per-wallet rule can never unblock an account-wide blocklist", () => {
    expect(
      ctx({
        policies: [
          list("DESTINATION_BLOCKLIST", ["merchant-1"]),
          list("DESTINATION_ALLOWLIST", ["merchant-1"], { walletId: "wal_1", priority: 99 }),
        ],
      }),
      "DENY",
      "DESTINATION_BLOCKED",
    );
  });

  test("blocklists union across scopes", () => {
    expect(
      ctx({
        intent: { ...ctx().intent, destination: "merchant-2" },
        policies: [
          list("DESTINATION_BLOCKLIST", ["merchant-1"]),
          list("DESTINATION_BLOCKLIST", ["merchant-2"], { walletId: "wal_1" }),
        ],
      }),
      "DENY",
      "DESTINATION_BLOCKED",
    );
  });

  test("a blocklist scoped to a different wallet does not apply", () => {
    expect(
      ctx({ policies: [list("DESTINATION_BLOCKLIST", ["merchant-1"], { walletId: "wal_other" })] }),
      "ALLOW",
      "WITHIN_POLICY",
    );
  });

});

describe("Stage 5: budgets, daily and monthly simultaneously", () => {
  test("daily limit denies on exact overshoot", () => {
    expect(
      ctx({
        noBaseline: true,
        policies: [limit("DAILY_LIMIT", "1000000", { walletId: "wal_1" })],
        budgets: [{ window: "DAY", spentAtomic: "1", reservedAtomic: "0" }],
      }),
      "DENY",
      "DAILY_LIMIT_EXCEEDED",
    );
  });

  test("daily limit allows spending exactly to the boundary", () => {
    expect(
      ctx({
        noBaseline: true,
        policies: [limit("DAILY_LIMIT", "1000000", { walletId: "wal_1" })],
        budgets: [{ window: "DAY", spentAtomic: "0", reservedAtomic: "0" }],
      }),
      "ALLOW",
      "WITHIN_POLICY",
    );
  });

  test("reserved budget counts against the limit, not just settled spend", () => {
    expect(
      ctx({
        noBaseline: true,
        policies: [limit("DAILY_LIMIT", "2000000", { walletId: "wal_1" })],
        budgets: [{ window: "DAY", spentAtomic: "500000", reservedAtomic: "600000" }],
      }),
      "DENY",
      "DAILY_LIMIT_EXCEEDED",
    );
  });

  test("monthly limit denies while the daily limit still has room", () => {
    expect(
      ctx({
        noBaseline: true,
        policies: [limit("DAILY_LIMIT", "9000000", { walletId: "wal_1" }), limit("MONTHLY_LIMIT", "1000000", { walletId: "wal_1" })],
        budgets: [
          { window: "DAY", spentAtomic: "0", reservedAtomic: "0" },
          { window: "MONTH", spentAtomic: "500000", reservedAtomic: "0" },
        ],
      }),
      "DENY",
      "MONTHLY_LIMIT_EXCEEDED",
    );
  });

  test("daily and monthly apply simultaneously, daily reported first", () => {
    expect(
      ctx({
        noBaseline: true,
        policies: [limit("DAILY_LIMIT", "100", { walletId: "wal_1" }), limit("MONTHLY_LIMIT", "100", { walletId: "wal_1" })],
        budgets: [
          { window: "DAY", spentAtomic: "100", reservedAtomic: "0" },
          { window: "MONTH", spentAtomic: "100", reservedAtomic: "0" },
        ],
      }),
      "DENY",
      "DAILY_LIMIT_EXCEEDED",
    );
  });

  test("a missing budget row means nothing spent yet", () => {
    expect(ctx({ noBaseline: true, policies: [limit("DAILY_LIMIT", "1000000", { walletId: "wal_1" })], budgets: [] }), "ALLOW", "WITHIN_POLICY");
  });

  test("no budget policy for MONTH means no monthly ceiling, even with authority from DAILY_LIMIT", () => {
    expect(
      ctx({
        noBaseline: true,
        policies: [limit("DAILY_LIMIT", "999999999999", { walletId: "wal_1" })],
        intent: { ...ctx().intent, atomicAmount: "999999999999" },
      }),
      "ALLOW",
      "WITHIN_POLICY",
    );
  });

  test("budget arithmetic stays exact far beyond Number.MAX_SAFE_INTEGER", () => {
    expect(
      ctx({
        noBaseline: true,
        intent: { ...ctx().intent, atomicAmount: "1" },
        policies: [limit("DAILY_LIMIT", "9007199254740993", { walletId: "wal_1" })],
        budgets: [{ window: "DAY", spentAtomic: "9007199254740993", reservedAtomic: "0" }],
      }),
      "DENY",
      "DAILY_LIMIT_EXCEEDED",
    );
  });

});

describe("Stage 6: per-transaction ceiling", () => {
  test("per-transaction limit denies above the cap", () => {
    expect(ctx({ policies: [limit("PER_TRANSACTION_LIMIT", "999999", { walletId: "wal_1" })] }), "DENY", "PER_TRANSACTION_LIMIT_EXCEEDED");
  });

  test("per-transaction limit allows exactly at the cap", () => {
    expect(ctx({ policies: [limit("PER_TRANSACTION_LIMIT", "1000000", { walletId: "wal_1" })] }), "ALLOW", "WITHIN_POLICY");
  });

  test("budget stage outranks per-transaction stage", () => {
    expect(
      ctx({
        noBaseline: true,
        policies: [limit("DAILY_LIMIT", "1", { walletId: "wal_1" }), limit("PER_TRANSACTION_LIMIT", "1", { walletId: "wal_1" })],
      }),
      "DENY",
      "DAILY_LIMIT_EXCEEDED",
    );
  });

});

describe("Stage 7: allowlists", () => {
  test("asset allowlist denies an unlisted asset", () => {
    expect(ctx({ policies: [list("ASSET_ALLOWLIST", ["EURC"])] }), "DENY", "ASSET_NOT_ALLOWED");
  });

  test("network allowlist denies an unlisted network", () => {
    expect(ctx({ policies: [list("NETWORK_ALLOWLIST", ["stellar:mainnet"])] }), "DENY", "NETWORK_NOT_ALLOWED");
  });

  test("destination allowlist denies an unlisted destination", () => {
    expect(ctx({ policies: [list("DESTINATION_ALLOWLIST", ["merchant-9"])] }), "DENY", "DESTINATION_NOT_ALLOWED");
  });

  test("action allowlist denies an intent with no action at all", () => {
    expect(ctx({ policies: [list("ACTION_ALLOWLIST", ["TRANSFER"])] }), "DENY", "ACTION_NOT_ALLOWED");
  });

  test("action allowlist admits a listed action", () => {
    expect(
      ctx({
        intent: { ...ctx().intent, action: "TRANSFER" },
        policies: [list("ACTION_ALLOWLIST", ["TRANSFER"])],
      }),
      "ALLOW",
      "WITHIN_POLICY",
    );
  });

  test("no allowlist configured means the dimension is unrestricted", () => {
    expect(ctx({ intent: { ...ctx().intent, assetCode: "ANYTHING" } }), "ALLOW", "WITHIN_POLICY");
  });

  test("per-transaction stage outranks allowlist stage", () => {
    expect(
      ctx({
        policies: [limit("PER_TRANSACTION_LIMIT", "1", { walletId: "wal_1" }), list("ASSET_ALLOWLIST", ["EURC"])],
      }),
      "DENY",
      "PER_TRANSACTION_LIMIT_EXCEEDED",
    );
  });

  test("tied allowlists intersect rather than widen", () => {
    expect(
      ctx({
        policies: [
          list("ASSET_ALLOWLIST", ["USDC", "EURC"], { priority: 5 }),
          list("ASSET_ALLOWLIST", ["EURC"], { priority: 5 }),
        ],
      }),
      "DENY",
      "ASSET_NOT_ALLOWED",
    );
  });

});

describe("Stage 8-9: approvals", () => {
  test("x402 autopay ceiling escalates to approval", () => {
    expect(
      ctx({
        intent: { ...ctx().intent, type: "X402_PAYMENT" },
        policies: [rule("X402_MAX_AUTOPAY", { maxAutopayAtomic: "500000" }, { walletId: "wal_1" })],
      }),
      "REQUIRE_APPROVAL",
      "X402_AUTOPAY_EXCEEDED",
    );
  });

  test("x402 autopay ceiling allows a small purchase outright", () => {
    expect(
      ctx({
        intent: { ...ctx().intent, type: "X402_PAYMENT", atomicAmount: "250000" },
        policies: [rule("X402_MAX_AUTOPAY", { maxAutopayAtomic: "500000" }, { walletId: "wal_1" })],
      }),
      "ALLOW",
      "WITHIN_POLICY",
    );
  });

  test("x402 autopay ceiling does not apply to a plain transfer", () => {
    expect(
      ctx({ policies: [rule("X402_MAX_AUTOPAY", { maxAutopayAtomic: "1" }, { walletId: "wal_1" })] }),
      "ALLOW",
      "WITHIN_POLICY",
    );
  });

  test("approval threshold triggers at exactly the threshold", () => {
    expect(
      ctx({ policies: [rule("APPROVAL_THRESHOLD", { thresholdAtomic: "1000000" }, { walletId: "wal_1" })] }),
      "REQUIRE_APPROVAL",
      "APPROVAL_REQUIRED",
    );
  });

  test("approval threshold does not trigger just below", () => {
    expect(
      ctx({ policies: [rule("APPROVAL_THRESHOLD", { thresholdAtomic: "1000001" }, { walletId: "wal_1" })] }),
      "ALLOW",
      "WITHIN_POLICY",
    );
  });

  test("a hard deny outranks an approval escalation", () => {
    expect(
      ctx({
        policies: [
          limit("PER_TRANSACTION_LIMIT", "1", { walletId: "wal_1" }),
          rule("APPROVAL_THRESHOLD", { thresholdAtomic: "1" }, { walletId: "wal_1" }),
        ],
      }),
      "DENY",
      "PER_TRANSACTION_LIMIT_EXCEEDED",
    );
  });

  test("x402 ceiling is reported ahead of a generic approval threshold", () => {
    expect(
      ctx({
        intent: { ...ctx().intent, type: "X402_PAYMENT" },
        policies: [
          rule("X402_MAX_AUTOPAY", { maxAutopayAtomic: "1" }, { walletId: "wal_1" }),
          rule("APPROVAL_THRESHOLD", { thresholdAtomic: "1" }, { walletId: "wal_1" }),
        ],
      }),
      "REQUIRE_APPROVAL",
      "X402_AUTOPAY_EXCEEDED",
    );
  });

});

describe("Scope resolution", () => {
  test("a per-wallet limit replaces the account-wide limit, raising it", () => {
    expect(
      ctx({
        policies: [
          limit("PER_TRANSACTION_LIMIT", "500000"),
          limit("PER_TRANSACTION_LIMIT", "2000000", { walletId: "wal_1" }),
        ],
      }),
      "ALLOW",
      "WITHIN_POLICY",
    );
  });

  test("a per-wallet limit replaces the account-wide limit, lowering it", () => {
    expect(
      ctx({
        policies: [
          limit("PER_TRANSACTION_LIMIT", "5000000"),
          limit("PER_TRANSACTION_LIMIT", "10", { walletId: "wal_1" }),
        ],
      }),
      "DENY",
      "PER_TRANSACTION_LIMIT_EXCEEDED",
    );
  });

  test("a limit scoped to another wallet is ignored", () => {
    expect(
      ctx({
        policies: [
          limit("PER_TRANSACTION_LIMIT", "5000000"),
          limit("PER_TRANSACTION_LIMIT", "1", { walletId: "wal_other" }),
        ],
      }),
      "ALLOW",
      "WITHIN_POLICY",
    );
  });

  test("higher priority wins within the same scope", () => {
    expect(
      ctx({
        policies: [
          limit("PER_TRANSACTION_LIMIT", "1", { walletId: "wal_1", priority: 1 }),
          limit("PER_TRANSACTION_LIMIT", "5000000", { walletId: "wal_1", priority: 10 }),
        ],
      }),
      "ALLOW",
      "WITHIN_POLICY",
    );
  });

  test("equal priority falls back to the most restrictive limit", () => {
    expect(
      ctx({
        policies: [
          limit("PER_TRANSACTION_LIMIT", "5000000", { walletId: "wal_1", priority: 3 }),
          limit("PER_TRANSACTION_LIMIT", "1", { walletId: "wal_1", priority: 3 }),
        ],
      }),
      "DENY",
      "PER_TRANSACTION_LIMIT_EXCEEDED",
    );
  });

  test("a disabled rule is inert", () => {
    expect(
      ctx({ policies: [limit("PER_TRANSACTION_LIMIT", "1", { walletId: "wal_1", enabled: false })] }),
      "ALLOW",
      "WITHIN_POLICY",
    );
  });

  test("evaluation is independent of rule ordering", () => {
    const rules = [
      limit("DAILY_LIMIT", "5000000", { walletId: "wal_1" }),
      list("ASSET_ALLOWLIST", ["USDC"]),
      limit("PER_TRANSACTION_LIMIT", "2000000", { walletId: "wal_1" }),
      rule("APPROVAL_THRESHOLD", { thresholdAtomic: "1500000" }, { walletId: "wal_1" }),
    ];
    const forward = evaluatePolicy(ctx({ noBaseline: true, policies: rules }));
    const reversed = evaluatePolicy(ctx({ noBaseline: true, policies: [...rules].reverse() }));
    assert.equal(forward.decision, reversed.decision);
    assert.equal(forward.reason, reversed.reason);
  });

});

describe("Output shape and validation", () => {
  test("WALLET_STATUS is accepted as a spec-conformance no-op", () => {
    expect(ctx({ policies: [rule("WALLET_STATUS", {})] }), "ALLOW", "WITHIN_POLICY");
  });

  test("a denial names the policy that caused it", () => {
    const denying = limit("PER_TRANSACTION_LIMIT", "1", { walletId: "wal_1" });
    const result = evaluatePolicy(ctx({ policies: [denying] }));
    assert.deepEqual(result.matchedPolicyIds, [denying.id]);
  });

  test("the trace records every stage reached", () => {
    const result = evaluatePolicy(ctx());
    const stages = result.trace.map((t) => t.stage);
    assert.deepEqual(stages, [
      "account_status",
      "wallet_status",
      "spending_authority",
      "blocklist",
      "budget",
      "per_transaction",
      "allowlist",
      "x402_autopay",
      "approval_threshold",
      "allow",
    ]);
  });

  test("the trace stops at the denying stage", () => {
    const result = evaluatePolicy(ctx({ wallet: { id: "wal_1", status: "ARCHIVED" } }));
    assert.deepEqual(
      result.trace.map((t) => t.stage),
      ["account_status", "wallet_status"],
    );
    assert.equal(result.trace.at(-1)?.outcome, "match");
  });

  test("a float amount is rejected rather than silently coerced", () => {
    assert.throws(() => evaluatePolicy(ctx({ intent: { ...ctx().intent, atomicAmount: "1.5" } })));
  });

  test("a negative amount is rejected", () => {
    assert.throws(() => evaluatePolicy(ctx({ intent: { ...ctx().intent, atomicAmount: "-1" } })));
  });

  test("a rule whose config does not match its type is rejected", () => {
    assert.throws(() => evaluatePolicy(ctx({ policies: [rule("DAILY_LIMIT", { values: ["nope"] }, { walletId: "wal_1" })] })));
  });

  test("asset codes are compared case-insensitively", () => {
    expect(
      ctx({ intent: { ...ctx().intent, assetCode: "usdc" }, policies: [list("ASSET_ALLOWLIST", ["USDC"])] }),
      "ALLOW",
      "WITHIN_POLICY",
    );
  });
});
