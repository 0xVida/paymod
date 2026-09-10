-- Postgres has no direct "drop enum value" operation. Swap in a narrower
-- type and cast the existing column across: safe here because nothing in
-- the application ever writes DEPLOYING, VERIFYING, PAUSED or FAILED to
-- agent_wallets.status, so no row can hold a value the new type rejects.
CREATE TYPE "AgentWalletStatus_new" AS ENUM ('CREATING', 'AWAITING_SIGNATURE', 'ACTIVE', 'ARCHIVED');

ALTER TABLE "agent_wallets" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "agent_wallets" ALTER COLUMN "status" TYPE "AgentWalletStatus_new" USING ("status"::text::"AgentWalletStatus_new");
ALTER TABLE "agent_wallets" ALTER COLUMN "status" SET DEFAULT 'CREATING';

DROP TYPE "AgentWalletStatus";
ALTER TYPE "AgentWalletStatus_new" RENAME TO "AgentWalletStatus";
