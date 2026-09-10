-- CreateEnum
CREATE TYPE "CodeLedgerEntryType" AS ENUM ('DEPOSIT', 'USAGE_CHARGE', 'REFUND', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "InferenceProvider" AS ENUM ('OPENAI', 'ANTHROPIC');

-- CreateEnum
CREATE TYPE "UsageReservationStatus" AS ENUM ('RESERVED', 'COMMITTED', 'RELEASED', 'EXPIRED', 'RECONCILIATION_REQUIRED');

-- AlterTable
ALTER TABLE "code_ledger_entries" DROP COLUMN "usdc_atomic",
ADD COLUMN     "amount_atomic" DECIMAL(78,0) NOT NULL,
ADD COLUMN     "type" "CodeLedgerEntryType" NOT NULL,
ADD COLUMN     "usage_event_id" TEXT,
ALTER COLUMN "tx_signature" DROP NOT NULL;

-- CreateTable
CREATE TABLE "code_account_balances" (
    "account_id" TEXT NOT NULL,
    "balance_atomic" DECIMAL(78,0) NOT NULL,
    "reserved_atomic" DECIMAL(78,0) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "code_account_balances_pkey" PRIMARY KEY ("account_id")
);

-- CreateTable
CREATE TABLE "provider_api_keys" (
    "id" TEXT NOT NULL,
    "provider" "InferenceProvider" NOT NULL,
    "label" TEXT NOT NULL,
    "encrypted_key" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "provider_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_pricing" (
    "id" TEXT NOT NULL,
    "provider" "InferenceProvider" NOT NULL,
    "model" TEXT NOT NULL,
    "input_token_price_atomic" DECIMAL(78,0) NOT NULL,
    "cached_input_token_price_atomic" DECIMAL(78,0),
    "output_token_price_atomic" DECIMAL(78,0) NOT NULL,
    "markup_basis_points" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),

    CONSTRAINT "model_pricing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_reservations" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "provider" "InferenceProvider" NOT NULL,
    "model" TEXT NOT NULL,
    "pricing_version" INTEGER NOT NULL,
    "estimated_atomic" DECIMAL(78,0) NOT NULL,
    "actual_atomic" DECIMAL(78,0),
    "status" "UsageReservationStatus" NOT NULL DEFAULT 'RESERVED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalized_at" TIMESTAMP(3),

    CONSTRAINT "usage_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_events" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "reservation_id" TEXT NOT NULL,
    "provider" "InferenceProvider" NOT NULL,
    "model" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "cached_input_tokens" INTEGER,
    "output_tokens" INTEGER NOT NULL,
    "provider_cost_atomic" DECIMAL(78,0) NOT NULL,
    "markup_atomic" DECIMAL(78,0) NOT NULL,
    "charged_atomic" DECIMAL(78,0) NOT NULL,
    "pricing_version" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "provider_api_keys_provider_is_active_idx" ON "provider_api_keys"("provider", "is_active");

-- CreateIndex
CREATE INDEX "model_pricing_provider_model_effective_from_idx" ON "model_pricing"("provider", "model", "effective_from");

-- CreateIndex
CREATE INDEX "usage_reservations_account_id_status_idx" ON "usage_reservations"("account_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "usage_events_reservation_id_key" ON "usage_events"("reservation_id");

-- CreateIndex
CREATE INDEX "usage_events_account_id_created_at_idx" ON "usage_events"("account_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "code_ledger_entries_usage_event_id_key" ON "code_ledger_entries"("usage_event_id");

-- AddForeignKey
ALTER TABLE "code_ledger_entries" ADD CONSTRAINT "code_ledger_entries_usage_event_id_fkey" FOREIGN KEY ("usage_event_id") REFERENCES "usage_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_account_balances" ADD CONSTRAINT "code_account_balances_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_reservations" ADD CONSTRAINT "usage_reservations_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

