CREATE TABLE "code_credentials" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "code_credentials_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "code_credentials_prefix_key" ON "code_credentials"("prefix");
CREATE INDEX "code_credentials_wallet_id_idx" ON "code_credentials"("wallet_id");
CREATE INDEX "code_credentials_account_id_idx" ON "code_credentials"("account_id");

ALTER TABLE "code_credentials" ADD CONSTRAINT "code_credentials_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "code_credentials" ADD CONSTRAINT "code_credentials_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "agent_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
