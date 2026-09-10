-- DropIndex
DROP INDEX "budget_periods_window_key";

-- DropIndex
DROP INDEX "settlements_wallet_payment_id_key";

-- CreateTable
CREATE TABLE "code_deposit_addresses" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "encrypted_secret_key" TEXT NOT NULL,
    "last_processed_signature" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "code_deposit_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_ledger_entries" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "usdc_atomic" TEXT NOT NULL,
    "tx_signature" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "code_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "code_deposit_addresses_account_id_key" ON "code_deposit_addresses"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "code_deposit_addresses_address_key" ON "code_deposit_addresses"("address");

-- CreateIndex
CREATE INDEX "code_ledger_entries_account_id_created_at_idx" ON "code_ledger_entries"("account_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "code_ledger_entries_tx_signature_account_id_key" ON "code_ledger_entries"("tx_signature", "account_id");

-- AddForeignKey
ALTER TABLE "code_deposit_addresses" ADD CONSTRAINT "code_deposit_addresses_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_ledger_entries" ADD CONSTRAINT "code_ledger_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Note: the hand-written "budget_periods_window_key" and
-- "settlements_wallet_payment_id_key" indexes are not declared in
-- schema.prisma (they encode invariants Prisma's DSL cannot express - see
-- schema.prisma's own header comment), so this migration's auto-generated
-- diff dropped both as collateral, same as 20260815023612_add_auth_models
-- did before it. Recreated here, matching how 20260817000000_agent_wallet_v1
-- restored them the first time this happened.

-- NULLS NOT DISTINCT so an account-wide budget (wallet_id IS NULL) is
-- still deduplicated correctly - without it Postgres treats every NULL as
-- unique and concurrent reservations silently create duplicate budget
-- periods, each with its own limit, which is exactly the anti-overspend
-- guarantee reservations.ts exists to prevent. Requires PG >= 15.
CREATE UNIQUE INDEX "budget_periods_window_key"
  ON "budget_periods" ("account_id", "wallet_id", "window", "asset_code", "network_id", "starts_at", "ends_at")
  NULLS NOT DISTINCT;

-- The deterministic payment id must be unique per wallet: it is the
-- application-side mirror of the contract's on-chain replay protection.
CREATE UNIQUE INDEX "settlements_wallet_payment_id_key"
  ON "settlements" ("wallet_id", "payment_id_hex");
