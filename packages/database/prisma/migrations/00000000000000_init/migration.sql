-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('PERSONAL', 'TEAM');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "SpenderStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TreasuryStatus" AS ENUM ('UNVERIFIED', 'ACTIVE', 'PAUSED');

-- CreateEnum
CREATE TYPE "IntentType" AS ENUM ('TRANSFER', 'X402_PAYMENT');

-- CreateEnum
CREATE TYPE "IntentStatus" AS ENUM ('PENDING', 'WAITING_APPROVAL', 'AUTHORIZED', 'PROCESSING', 'COMPLETED', 'DENIED', 'FAILED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PolicyDecision" AS ENUM ('ALLOW', 'DENY', 'REQUIRE_APPROVAL');

-- CreateEnum
CREATE TYPE "BudgetWindow" AS ENUM ('DAY', 'MONTH');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('RESERVED', 'COMMITTED', 'RELEASED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('PREPARING', 'SUBMITTED', 'CONFIRMED', 'FAILED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ChainAttemptStatus" AS ENUM ('SUBMITTED', 'CONFIRMED', 'FAILED', 'UNKNOWN');

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL DEFAULT 'PERSONAL',
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spenders" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "SpenderStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "spenders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spender_credentials" (
    "id" TEXT NOT NULL,
    "spender_id" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spender_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treasuries" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "network_id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "owner_address" TEXT NOT NULL,
    "executor_address" TEXT NOT NULL,
    "status" "TreasuryStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "treasuries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treasury_assets" (
    "id" TEXT NOT NULL,
    "treasury_id" TEXT NOT NULL,
    "asset_code" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL,
    "contract_address" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "treasury_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policies" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "spender_id" TEXT,
    "type" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_intents" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "spender_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "type" "IntentType" NOT NULL,
    "status" "IntentStatus" NOT NULL DEFAULT 'PENDING',
    "atomic_amount" DECIMAL(78,0) NOT NULL,
    "asset_code" TEXT NOT NULL,
    "network_id" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "action" TEXT,
    "purpose" TEXT,
    "decision" "PolicyDecision",
    "decision_reason" TEXT,
    "policy_trace" JSONB,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "locked_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_periods" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "spender_id" TEXT,
    "window" "BudgetWindow" NOT NULL,
    "asset_code" TEXT NOT NULL,
    "network_id" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "limit_atomic" DECIMAL(78,0) NOT NULL,
    "spent_atomic" DECIMAL(78,0) NOT NULL,
    "reserved_atomic" DECIMAL(78,0) NOT NULL,

    CONSTRAINT "budget_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spend_reservations" (
    "id" TEXT NOT NULL,
    "budget_period_id" TEXT NOT NULL,
    "intent_id" TEXT NOT NULL,
    "spender_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "requested_atomic" DECIMAL(78,0) NOT NULL,
    "actual_atomic" DECIMAL(78,0),
    "status" "ReservationStatus" NOT NULL DEFAULT 'RESERVED',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalized_at" TIMESTAMP(3),

    CONSTRAINT "spend_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlements" (
    "id" TEXT NOT NULL,
    "intent_id" TEXT NOT NULL,
    "treasury_id" TEXT NOT NULL,
    "payment_id_hex" TEXT NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'PREPARING',
    "tx_hash" TEXT,
    "failure_code" TEXT,
    "actual_atomic" DECIMAL(78,0),
    "submitted_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chain_tx_attempts" (
    "id" TEXT NOT NULL,
    "settlement_id" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "tx_hash" TEXT,
    "status" "ChainAttemptStatus" NOT NULL DEFAULT 'SUBMITTED',
    "error_code" TEXT,
    "envelope_xdr" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chain_tx_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "intent_id" TEXT,
    "response_snapshot" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "request_id" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "spenders_account_id_idx" ON "spenders"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "spender_credentials_prefix_key" ON "spender_credentials"("prefix");

-- CreateIndex
CREATE INDEX "spender_credentials_spender_id_idx" ON "spender_credentials"("spender_id");

-- CreateIndex
CREATE INDEX "treasuries_account_id_idx" ON "treasuries"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "treasuries_network_id_contract_id_key" ON "treasuries"("network_id", "contract_id");

-- CreateIndex
CREATE UNIQUE INDEX "treasury_assets_treasury_id_asset_code_key" ON "treasury_assets"("treasury_id", "asset_code");

-- CreateIndex
CREATE INDEX "policies_account_id_enabled_idx" ON "policies"("account_id", "enabled");

-- CreateIndex
CREATE INDEX "policies_spender_id_idx" ON "policies"("spender_id");

-- CreateIndex
CREATE INDEX "financial_intents_status_locked_at_idx" ON "financial_intents"("status", "locked_at");

-- CreateIndex
CREATE INDEX "financial_intents_account_id_created_at_idx" ON "financial_intents"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "financial_intents_spender_id_created_at_idx" ON "financial_intents"("spender_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "spend_reservations_budget_period_id_idempotency_key_key" ON "spend_reservations"("budget_period_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "spend_reservations_intent_id_budget_period_id_key" ON "spend_reservations"("intent_id", "budget_period_id");

-- CreateIndex
CREATE UNIQUE INDEX "settlements_intent_id_key" ON "settlements"("intent_id");

-- CreateIndex
CREATE INDEX "settlements_status_idx" ON "settlements"("status");

-- CreateIndex
CREATE UNIQUE INDEX "chain_tx_attempts_settlement_id_attempt_key" ON "chain_tx_attempts"("settlement_id", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_account_id_key_key" ON "idempotency_records"("account_id", "key");

-- CreateIndex
CREATE INDEX "audit_events_account_id_created_at_idx" ON "audit_events"("account_id", "created_at");

-- AddForeignKey
ALTER TABLE "spenders" ADD CONSTRAINT "spenders_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spender_credentials" ADD CONSTRAINT "spender_credentials_spender_id_fkey" FOREIGN KEY ("spender_id") REFERENCES "spenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasuries" ADD CONSTRAINT "treasuries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_assets" ADD CONSTRAINT "treasury_assets_treasury_id_fkey" FOREIGN KEY ("treasury_id") REFERENCES "treasuries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_spender_id_fkey" FOREIGN KEY ("spender_id") REFERENCES "spenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_intents" ADD CONSTRAINT "financial_intents_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_intents" ADD CONSTRAINT "financial_intents_spender_id_fkey" FOREIGN KEY ("spender_id") REFERENCES "spenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_periods" ADD CONSTRAINT "budget_periods_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_periods" ADD CONSTRAINT "budget_periods_spender_id_fkey" FOREIGN KEY ("spender_id") REFERENCES "spenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spend_reservations" ADD CONSTRAINT "spend_reservations_budget_period_id_fkey" FOREIGN KEY ("budget_period_id") REFERENCES "budget_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spend_reservations" ADD CONSTRAINT "spend_reservations_intent_id_fkey" FOREIGN KEY ("intent_id") REFERENCES "financial_intents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_intent_id_fkey" FOREIGN KEY ("intent_id") REFERENCES "financial_intents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_treasury_id_fkey" FOREIGN KEY ("treasury_id") REFERENCES "treasuries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chain_tx_attempts" ADD CONSTRAINT "chain_tx_attempts_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ===========================================================================
-- HAND-WRITTEN INVARIANTS
--
-- Everything below this line is maintained by hand. Prisma's schema language
-- cannot express CHECK constraints, partial indexes or NULLS NOT DISTINCT,
-- and these are precisely the guarantees that stop a budget being overspent.
--
-- If you change `schema.prisma`, re-generate the DDL above and re-append this
-- block. `npm run diff:check` in CI fails if the two drift apart.
-- ===========================================================================

-- --- budget_periods --------------------------------------------------------

-- THE overspend guard. Every reserve/commit path is written so that violating
-- this raises rather than silently corrupting the ledger. Do not relax it.
ALTER TABLE "budget_periods"
  ADD CONSTRAINT "budget_periods_no_overspend"
  CHECK ("spent_atomic" + "reserved_atomic" <= "limit_atomic");

ALTER TABLE "budget_periods"
  ADD CONSTRAINT "budget_periods_non_negative"
  CHECK ("limit_atomic" >= 0 AND "spent_atomic" >= 0 AND "reserved_atomic" >= 0);

ALTER TABLE "budget_periods"
  ADD CONSTRAINT "budget_periods_window_ordered"
  CHECK ("ends_at" > "starts_at");

-- One window per (account, spender, kind, asset, network, range). NULLS NOT
-- DISTINCT makes account-wide rows (spender_id IS NULL) collide correctly  -
-- without it Postgres treats every NULL as unique and you silently get
-- duplicate account-wide budgets, each with its own limit. Requires PG >= 15.
CREATE UNIQUE INDEX "budget_periods_window_key"
  ON "budget_periods" ("account_id", "spender_id", "window", "asset_code", "network_id", "starts_at", "ends_at")
  NULLS NOT DISTINCT;

-- --- spend_reservations ----------------------------------------------------

ALTER TABLE "spend_reservations"
  ADD CONSTRAINT "spend_reservations_requested_positive"
  CHECK ("requested_atomic" > 0);

-- Actual usage may come in under the reservation but never over it. An overage
-- must become a new, separately-governed intent rather than silently overspend.
ALTER TABLE "spend_reservations"
  ADD CONSTRAINT "spend_reservations_actual_within_requested"
  CHECK ("actual_atomic" IS NULL OR ("actual_atomic" >= 0 AND "actual_atomic" <= "requested_atomic"));

-- An open reservation carries no outcome; a finalized one always does.
ALTER TABLE "spend_reservations"
  ADD CONSTRAINT "spend_reservations_lifecycle"
  CHECK (
    ("status" = 'RESERVED' AND "actual_atomic" IS NULL AND "finalized_at" IS NULL)
    OR ("status" <> 'RESERVED' AND "finalized_at" IS NOT NULL)
  );

-- Drives the expiry sweeper. Partial, so it stays small no matter how much
-- settled history accumulates.
CREATE INDEX "spend_reservations_open_expiry"
  ON "spend_reservations" ("expires_at")
  WHERE "status" = 'RESERVED';

-- --- settlements -----------------------------------------------------------

-- The deterministic payment id must be unique per treasury: it is the
-- application-side mirror of the contract's on-chain replay protection.
CREATE UNIQUE INDEX "settlements_treasury_payment_id_key"
  ON "settlements" ("treasury_id", "payment_id_hex");

-- --- audit_events ----------------------------------------------------------

-- Append-only in the strongest form the schema can state. Application roles
-- are granted INSERT and SELECT only; this trigger stops anything else even if
-- a future grant is too generous.
CREATE OR REPLACE FUNCTION "audit_events_append_only"() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only (attempted %)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_events_no_mutate"
  BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION "audit_events_append_only"();
