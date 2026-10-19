-- Super admin portal: admin accounts (created by the command line only), their passkeys, and sign-in sessions.
CREATE TYPE "admin_session_stage" AS ENUM ('PASSWORD_OK', 'VERIFIED');

CREATE TABLE "admin_users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "username" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "phone_enc" BYTEA NOT NULL,
    "phone_hash" BYTEA NOT NULL,
    "failed_logins" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "password_changed_at" TIMESTAMPTZ(6) NOT NULL,
    "last_login_at" TIMESTAMPTZ(6),
    "disabled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "admin_users_username_key" ON "admin_users"("username");

CREATE TABLE "admin_passkeys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "admin_id" UUID NOT NULL,
    "credential_id" TEXT NOT NULL,
    "public_key" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT[],
    "device_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "last_used_at" TIMESTAMPTZ(6),
    CONSTRAINT "admin_passkeys_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "admin_passkeys_credential_id_key" ON "admin_passkeys"("credential_id");
CREATE INDEX "admin_passkeys_admin_id_idx" ON "admin_passkeys"("admin_id");
ALTER TABLE "admin_passkeys" ADD CONSTRAINT "admin_passkeys_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "admin_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "admin_id" UUID NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "stage" "admin_session_stage" NOT NULL,
    "challenge" TEXT,
    "ip" TEXT NOT NULL,
    "user_agent" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "admin_sessions_token_hash_key" ON "admin_sessions"("token_hash");
CREATE INDEX "admin_sessions_admin_id_idx" ON "admin_sessions"("admin_id");
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "admin_recoveries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "admin_id" UUID NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "ip" TEXT NOT NULL,
    "user_agent" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "ready_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    CONSTRAINT "admin_recoveries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "admin_recoveries_token_hash_key" ON "admin_recoveries"("token_hash");
CREATE INDEX "admin_recoveries_admin_id_idx" ON "admin_recoveries"("admin_id");
ALTER TABLE "admin_recoveries" ADD CONSTRAINT "admin_recoveries_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
