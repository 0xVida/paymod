CREATE TABLE "oauth_clients" (
    "id" TEXT NOT NULL,
    "account_id" TEXT,
    "name" TEXT,
    "redirect_uris" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_clients_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "oauth_authorization_codes" (
    "id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "code_challenge" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_authorization_codes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "oauth_tokens" (
    "id" TEXT NOT NULL,
    "access_token_hash" TEXT NOT NULL,
    "access_token_prefix" TEXT NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "refresh_token_prefix" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "refresh_expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "oauth_authorization_codes_code_hash_key" ON "oauth_authorization_codes"("code_hash");
CREATE INDEX "oauth_authorization_codes_client_id_expires_at_idx" ON "oauth_authorization_codes"("client_id", "expires_at");
CREATE INDEX "oauth_authorization_codes_wallet_id_idx" ON "oauth_authorization_codes"("wallet_id");
CREATE UNIQUE INDEX "oauth_tokens_access_token_hash_key" ON "oauth_tokens"("access_token_hash");
CREATE UNIQUE INDEX "oauth_tokens_access_token_prefix_key" ON "oauth_tokens"("access_token_prefix");
CREATE UNIQUE INDEX "oauth_tokens_refresh_token_hash_key" ON "oauth_tokens"("refresh_token_hash");
CREATE UNIQUE INDEX "oauth_tokens_refresh_token_prefix_key" ON "oauth_tokens"("refresh_token_prefix");
CREATE INDEX "oauth_tokens_wallet_id_idx" ON "oauth_tokens"("wallet_id");
CREATE INDEX "oauth_tokens_client_id_expires_at_idx" ON "oauth_tokens"("client_id", "expires_at");
ALTER TABLE "oauth_clients" ADD CONSTRAINT "oauth_clients_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "agent_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "agent_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
