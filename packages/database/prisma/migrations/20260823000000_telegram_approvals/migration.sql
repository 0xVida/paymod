-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ApprovalChannel" AS ENUM ('TELEGRAM');

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "intent_id" TEXT NOT NULL,
    "channel" "ApprovalChannel" NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "telegram_chat_id" TEXT,
    "telegram_message_id" TEXT,
    "resolved_by_telegram_user_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_connections" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "telegram_user_id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "username" TEXT,
    "first_name" TEXT,
    "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_link_requests" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "token_prefix" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_link_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "approval_requests_intent_id_key" ON "approval_requests"("intent_id");
CREATE INDEX "approval_requests_account_id_status_idx" ON "approval_requests"("account_id", "status");
CREATE UNIQUE INDEX "telegram_connections_account_id_key" ON "telegram_connections"("account_id");
CREATE INDEX "telegram_connections_telegram_user_id_idx" ON "telegram_connections"("telegram_user_id");
CREATE UNIQUE INDEX "telegram_link_requests_token_prefix_key" ON "telegram_link_requests"("token_prefix");
CREATE UNIQUE INDEX "telegram_link_requests_token_hash_key" ON "telegram_link_requests"("token_hash");
CREATE INDEX "telegram_link_requests_account_id_expires_at_idx" ON "telegram_link_requests"("account_id", "expires_at");

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_intent_id_fkey" FOREIGN KEY ("intent_id") REFERENCES "financial_intents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "telegram_connections" ADD CONSTRAINT "telegram_connections_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "telegram_link_requests" ADD CONSTRAINT "telegram_link_requests_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
