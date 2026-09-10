-- Circle is now the only rail new wallets are created on. Existing rows
-- keep whatever rail they already have - this only changes the column's
-- default for future inserts that omit it.
ALTER TABLE "agent_wallets" ALTER COLUMN "rail" SET DEFAULT 'CIRCLE';
