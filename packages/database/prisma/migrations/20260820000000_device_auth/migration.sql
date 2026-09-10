-- CreateEnum
CREATE TYPE "AgentWalletSource" AS ENUM ('DASHBOARD', 'PAYMOD_CODE');

-- CreateEnum
CREATE TYPE "DeviceAuthStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'CONSUMED', 'EXPIRED');

-- "budget_periods_window_key" and "settlements_wallet_payment_id_key" are
-- hand-written invariant indexes (schema.prisma's header comment), not
-- declared in schema.prisma, so `prisma migrate diff` always proposes
-- dropping them here. Left in place untouched, same as the
-- 20260817000000_agent_wallet_v1 migration's own note on this.

-- AlterTable
ALTER TABLE "agent_wallets" ADD COLUMN     "source" "AgentWalletSource";

-- CreateTable
CREATE TABLE "device_auth_requests" (
    "id" TEXT NOT NULL,
    "device_code_hash" TEXT NOT NULL,
    "device_code_prefix" TEXT NOT NULL,
    "user_code" TEXT NOT NULL,
    "status" "DeviceAuthStatus" NOT NULL DEFAULT 'PENDING',
    "account_id" TEXT,
    "wallet_id" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_auth_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "device_auth_requests_device_code_hash_key" ON "device_auth_requests"("device_code_hash");

-- CreateIndex
CREATE UNIQUE INDEX "device_auth_requests_device_code_prefix_key" ON "device_auth_requests"("device_code_prefix");

-- CreateIndex
CREATE UNIQUE INDEX "device_auth_requests_user_code_key" ON "device_auth_requests"("user_code");

-- CreateIndex
CREATE INDEX "device_auth_requests_account_id_idx" ON "device_auth_requests"("account_id");

-- AddForeignKey
ALTER TABLE "device_auth_requests" ADD CONSTRAINT "device_auth_requests_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_auth_requests" ADD CONSTRAINT "device_auth_requests_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "agent_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

