-- Reconstructed: this change was already applied directly to shared dev
-- databases (confirmed via \d wallet_assets) but the migration file was
-- never committed, which desynced migration history from schema.prisma.
-- This file makes the ledger honest about what already happened; it does
-- not change any running database's actual behavior.
ALTER TABLE "wallet_assets" ALTER COLUMN "contract_address" DROP NOT NULL;
