-- AlterTable
ALTER TABLE "usage_events" ADD COLUMN     "provider_request_id" TEXT;

-- Note: prisma migrate diff also proposed dropping "budget_periods_window_key"
-- and "settlements_wallet_payment_id_key" here, same collateral-drop pattern
-- documented in 20260904144737_code_deposit_ledger's migration.sql (Prisma
-- doesn't know either index exists - see schema.prisma's own header comment).
-- Deliberately omitted; both indexes remain in place throughout this migration.
