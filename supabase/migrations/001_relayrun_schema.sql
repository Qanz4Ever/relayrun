-- Combined reference migration for RelayRun schema, RLS, and private capability helpers
-- Applied to Supabase in 3 incremental migrations:
-- 1. create_relayrun_schema
-- 2. seed_relayrun_blueprints_and_index
-- 3. add_rr_private_rls_verification + add_rr_secrets_verify_select_policy

CREATE SCHEMA IF NOT EXISTS rr_private;

CREATE TABLE IF NOT EXISTS rr_private.app_config (
  key text PRIMARY KEY,
  value_hash text NOT NULL CHECK (char_length(value_hash) = 64),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- After applying, register your Cloudflare Worker secret hash (replace <SHA256_OF_RELAYRUN_WORKER_SECRET>):
-- INSERT INTO rr_private.app_config (key, value_hash)
-- VALUES ('worker_secret_hash', '<64-char-sha256-hex>')
-- ON CONFLICT (key) DO UPDATE SET value_hash = EXCLUDED.value_hash;
