-- Agent Wallet V1 (ADR 0010) + single-account model (ADR 0009 Decision 1).
--
-- Fresh start, not an in-place data migration  -  see
-- docs/WALLET_ARCHITECTURE_PLAN.md's "Migration strategy" section. The old
-- model (Account -> [Spender, ...], one shared Treasury; Account ->
-- [Membership, ...] team/personal split) has no objectively correct mapping
-- into the new one (Account -> [AgentWallet -> its own contract, ...], one
-- Account per User), so this clears the tables being restructured rather
-- than inventing a compatibility mapping to preserve pre-production testnet
-- data. Real customer data migrations are a different standard and do not
-- exist yet  -  there is none to protect here.
TRUNCATE TABLE
  "chain_tx_attempts", "settlements", "spend_reservations", "budget_periods",
  "financial_intents", "treasury_assets", "treasuries", "spender_credentials",
  "policies", "spenders", "audit_events", "idempotency_records", "memberships",
  "sessions", "accounts", "users"
  RESTART IDENTITY CASCADE;

-- CreateEnum
CREATE TYPE "AgentWalletStatus" AS ENUM ('CREATING', 'AWAITING_SIGNATURE', 'DEPLOYING', 'VERIFYING', 'ACTIVE', 'PAUSED', 'ARCHIVED', 'FAILED');

-- DropForeignKey
ALTER TABLE "budget_periods" DROP CONSTRAINT "budget_periods_spender_id_fkey";

-- DropForeignKey
ALTER TABLE "financial_intents" DROP CONSTRAINT "financial_intents_spender_id_fkey";

-- DropForeignKey
ALTER TABLE "memberships" DROP CONSTRAINT "memberships_account_id_fkey";

-- DropForeignKey
ALTER TABLE "memberships" DROP CONSTRAINT "memberships_user_id_fkey";

-- DropForeignKey
ALTER TABLE "policies" DROP CONSTRAINT "policies_spender_id_fkey";

-- DropForeignKey
ALTER TABLE "settlements" DROP CONSTRAINT "settlements_treasury_id_fkey";

-- DropForeignKey
ALTER TABLE "spender_credentials" DROP CONSTRAINT "spender_credentials_spender_id_fkey";

-- DropForeignKey
ALTER TABLE "spenders" DROP CONSTRAINT "spenders_account_id_fkey";

-- DropForeignKey
ALTER TABLE "treasuries" DROP CONSTRAINT "treasuries_account_id_fkey";

-- DropForeignKey
ALTER TABLE "treasury_assets" DROP CONSTRAINT "treasury_assets_treasury_id_fkey";

-- DropIndex
DROP INDEX "financial_intents_spender_id_created_at_idx";

-- DropIndex
DROP INDEX "policies_spender_id_idx";

-- Note: the hand-written "budget_periods_window_key" and
-- "settlements_treasury_payment_id_key" indexes do NOT currently exist  -
-- the 20260815023612_add_auth_models migration dropped both (collateral
-- from its own Prisma-generated diff) and never recreated them. Pre-existing
-- gap, unrelated to this migration; fixed as a side effect by the
-- CREATE UNIQUE INDEX statements in the HAND-WRITTEN INVARIANTS block below.

-- AlterTable
ALTER TABLE "accounts" DROP COLUMN "type",
ADD COLUMN     "user_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "budget_periods" DROP COLUMN "spender_id",
ADD COLUMN     "wallet_id" TEXT;

-- AlterTable
ALTER TABLE "financial_intents" DROP COLUMN "spender_id",
ADD COLUMN     "wallet_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "policies" DROP COLUMN "spender_id",
ADD COLUMN     "wallet_id" TEXT;

-- AlterTable
ALTER TABLE "settlements" DROP COLUMN "treasury_id",
ADD COLUMN     "wallet_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "spend_reservations" DROP COLUMN "spender_id",
ADD COLUMN     "wallet_id" TEXT NOT NULL;

-- DropTable
DROP TABLE "memberships";

-- DropTable
DROP TABLE "spender_credentials";

-- DropTable
DROP TABLE "spenders";

-- DropTable
DROP TABLE "treasuries";

-- DropTable
DROP TABLE "treasury_assets";

-- DropEnum
DROP TYPE "AccountType";

-- DropEnum
DROP TYPE "MembershipRole";

-- DropEnum
DROP TYPE "SpenderStatus";

-- DropEnum
DROP TYPE "TreasuryStatus";

-- CreateTable
CREATE TABLE "agent_wallets" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "AgentWalletStatus" NOT NULL DEFAULT 'CREATING',
    "network_id" TEXT,
    "contract_id" TEXT,
    "owner_address" TEXT,
    "executor_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_credentials" (
    "id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_assets" (
    "id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "asset_code" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL,
    "contract_address" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "wallet_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_wallets_account_id_idx" ON "agent_wallets"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_wallets_network_id_contract_id_key" ON "agent_wallets"("network_id", "contract_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_credentials_prefix_key" ON "wallet_credentials"("prefix");

-- CreateIndex
CREATE INDEX "wallet_credentials_wallet_id_idx" ON "wallet_credentials"("wallet_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_assets_wallet_id_asset_code_key" ON "wallet_assets"("wallet_id", "asset_code");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_user_id_key" ON "accounts"("user_id");

-- CreateIndex
CREATE INDEX "financial_intents_wallet_id_created_at_idx" ON "financial_intents"("wallet_id", "created_at");

-- CreateIndex
CREATE INDEX "policies_wallet_id_idx" ON "policies"("wallet_id");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_wallets" ADD CONSTRAINT "agent_wallets_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_credentials" ADD CONSTRAINT "wallet_credentials_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "agent_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_assets" ADD CONSTRAINT "wallet_assets_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "agent_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "agent_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_intents" ADD CONSTRAINT "financial_intents_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "agent_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_periods" ADD CONSTRAINT "budget_periods_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "agent_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "agent_wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================
-- HAND-WRITTEN INVARIANTS  -  rekey only
--
-- The init migration's hand-written CHECK constraints, the partial index,
-- and the audit_events append-only trigger are all still in place and
-- untouched by this migration  -  none of them reference a renamed column, so
-- ALTER TABLE ... DROP COLUMN / ADD COLUMN above left them alone. Only the
-- two indexes below named a renamed column (spender_id, treasury_id) and
-- were dropped earlier in this file; recreated here under the new names,
-- same logic.
--
-- If you change `schema.prisma`, re-generate the DDL above and re-append any
-- new hand-written invariant here. `npm run diff:check` in CI fails if the
-- two drift apart.
-- ===========================================================================

-- One window per (account, wallet, kind, asset, network, range). NULLS NOT
-- DISTINCT makes account-wide rows (wallet_id IS NULL) collide correctly  -
-- without it Postgres treats every NULL as unique and you silently get
-- duplicate account-wide budgets, each with its own limit. Requires PG >= 15.
CREATE UNIQUE INDEX "budget_periods_window_key"
  ON "budget_periods" ("account_id", "wallet_id", "window", "asset_code", "network_id", "starts_at", "ends_at")
  NULLS NOT DISTINCT;

-- The deterministic payment id must be unique per wallet: it is the
-- application-side mirror of the contract's on-chain replay protection.
CREATE UNIQUE INDEX "settlements_wallet_payment_id_key"
  ON "settlements" ("wallet_id", "payment_id_hex");
