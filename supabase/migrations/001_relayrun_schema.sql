-- RelayRun Complete Database Schema, RLS, Private Capability Helpers & Seed Data
-- Target: Supabase PostgreSQL 15+

-- ============================================================================
-- 1. Core Public Tables (Strict RLS, Write-Isolated via Cloudflare Worker)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.rr_blueprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL CHECK (char_length(slug) BETWEEN 3 AND 80),
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 120),
  summary text NOT NULL DEFAULT '' CHECK (char_length(summary) <= 400),
  category text NOT NULL CHECK (category IN ('release', 'incident', 'broadcast', 'migration', 'custom')),
  is_seeded boolean NOT NULL DEFAULT false,
  is_public boolean NOT NULL DEFAULT true,
  forked_from_id uuid REFERENCES public.rr_blueprints(id) ON DELETE SET NULL,
  run_count integer NOT NULL DEFAULT 0 CHECK (run_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rr_blueprint_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blueprint_id uuid NOT NULL REFERENCES public.rr_blueprints(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position BETWEEN 1 AND 30),
  title text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 140),
  step_type text NOT NULL CHECK (step_type IN ('manual', 'http_probe', 'decision')),
  owner_role text NOT NULL DEFAULT 'Operator' CHECK (char_length(owner_role) <= 40),
  expected_seconds integer NOT NULL DEFAULT 120 CHECK (expected_seconds BETWEEN 10 AND 86400),
  instructions text NOT NULL DEFAULT '' CHECK (char_length(instructions) <= 1500),
  probe_url text CHECK (probe_url IS NULL OR char_length(probe_url) <= 500),
  probe_method text CHECK (probe_method IS NULL OR probe_method IN ('GET', 'HEAD')),
  probe_expected_status integer CHECK (probe_expected_status IS NULL OR probe_expected_status BETWEEN 100 AND 599),
  probe_match_text text CHECK (probe_match_text IS NULL OR char_length(probe_match_text) <= 120),
  rollback_note text NOT NULL DEFAULT '' CHECK (char_length(rollback_note) <= 600),
  UNIQUE (blueprint_id, position)
);

CREATE TABLE IF NOT EXISTS public.rr_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_code text UNIQUE NOT NULL CHECK (char_length(run_code) BETWEEN 6 AND 16),
  blueprint_id uuid REFERENCES public.rr_blueprints(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 140),
  environment_label text NOT NULL DEFAULT 'Production' CHECK (char_length(environment_label) <= 40),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'aborted')),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  paused_accumulated_ms bigint NOT NULL DEFAULT 0 CHECK (paused_accumulated_ms >= 0),
  paused_at timestamptz,
  created_by_alias text NOT NULL DEFAULT 'Lead Operator' CHECK (char_length(created_by_alias) <= 40),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rr_run_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.rr_runs(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position BETWEEN 1 AND 30),
  title text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 140),
  step_type text NOT NULL CHECK (step_type IN ('manual', 'http_probe', 'decision')),
  owner_role text NOT NULL DEFAULT 'Operator' CHECK (char_length(owner_role) <= 40),
  claimed_by text CHECK (claimed_by IS NULL OR char_length(claimed_by) <= 40),
  expected_seconds integer NOT NULL DEFAULT 120 CHECK (expected_seconds BETWEEN 10 AND 86400),
  instructions text NOT NULL DEFAULT '' CHECK (char_length(instructions) <= 1500),
  probe_url text CHECK (probe_url IS NULL OR char_length(probe_url) <= 500),
  probe_method text CHECK (probe_method IS NULL OR probe_method IN ('GET', 'HEAD')),
  probe_expected_status integer CHECK (probe_expected_status IS NULL OR probe_expected_status BETWEEN 100 AND 599),
  probe_match_text text CHECK (probe_match_text IS NULL OR char_length(probe_match_text) <= 120),
  rollback_note text NOT NULL DEFAULT '' CHECK (char_length(rollback_note) <= 600),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'passed', 'failed', 'skipped')),
  started_at timestamptz,
  completed_at timestamptz,
  actual_seconds integer CHECK (actual_seconds IS NULL OR actual_seconds >= 0),
  operator_note text NOT NULL DEFAULT '' CHECK (char_length(operator_note) <= 600),
  UNIQUE (run_id, position)
);

CREATE TABLE IF NOT EXISTS public.rr_run_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.rr_runs(id) ON DELETE CASCADE,
  step_id uuid REFERENCES public.rr_run_steps(id) ON DELETE SET NULL,
  actor_alias text NOT NULL DEFAULT 'System' CHECK (char_length(actor_alias) <= 40),
  event_type text NOT NULL CHECK (event_type IN (
    'run_started', 'run_paused', 'run_resumed', 'run_completed', 'run_aborted',
    'step_claimed', 'step_started', 'step_passed', 'step_failed', 'step_skipped',
    'step_reopened', 'probe_executed', 'note_added'
  )),
  message text NOT NULL CHECK (char_length(message) <= 600),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rr_probe_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.rr_runs(id) ON DELETE CASCADE,
  step_id uuid NOT NULL REFERENCES public.rr_run_steps(id) ON DELETE CASCADE,
  target_url text NOT NULL CHECK (char_length(target_url) <= 500),
  method text NOT NULL CHECK (method IN ('GET', 'HEAD')),
  status_code integer,
  latency_ms integer NOT NULL CHECK (latency_ms >= 0),
  edge_colo text,
  matched boolean NOT NULL,
  response_snippet text CHECK (response_snippet IS NULL OR char_length(response_snippet) <= 600),
  error_message text CHECK (error_message IS NULL OR char_length(error_message) <= 400),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rr_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type text NOT NULL CHECK (resource_type IN ('blueprint', 'run')),
  resource_id uuid NOT NULL,
  key_hash text NOT NULL CHECK (char_length(key_hash) = 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (resource_type, resource_id)
);

-- ============================================================================
-- 2. Performance Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_rr_blueprints_public_created ON public.rr_blueprints (is_public, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rr_blueprints_forked_from ON public.rr_blueprints (forked_from_id);
CREATE INDEX IF NOT EXISTS idx_rr_blueprint_steps_bp_pos ON public.rr_blueprint_steps (blueprint_id, position);
CREATE INDEX IF NOT EXISTS idx_rr_runs_blueprint_id ON public.rr_runs (blueprint_id);
CREATE INDEX IF NOT EXISTS idx_rr_runs_created_at ON public.rr_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rr_run_steps_run_pos ON public.rr_run_steps (run_id, position);
CREATE INDEX IF NOT EXISTS idx_rr_run_events_run_created ON public.rr_run_events (run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rr_run_events_step_id ON public.rr_run_events (step_id);
CREATE INDEX IF NOT EXISTS idx_rr_probe_logs_run_created ON public.rr_probe_logs (run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rr_probe_logs_step_id ON public.rr_probe_logs (step_id);

-- ============================================================================
-- 3. Non-Exposed Private Schema for Worker & Capability Verification
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS rr_private;

CREATE TABLE IF NOT EXISTS rr_private.app_config (
  key text PRIMARY KEY,
  value_hash text NOT NULL CHECK (char_length(value_hash) = 64),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION rr_private.request_header(header_name text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
  SELECT COALESCE(
    (current_setting('request.headers', true)::jsonb ->> lower(header_name)),
    ''
  );
$$;

CREATE OR REPLACE FUNCTION rr_private.is_trusted_worker()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = rr_private, pg_catalog
AS $$
DECLARE
  raw_secret text;
  expected_hash text;
BEGIN
  raw_secret := rr_private.request_header('x-relayrun-worker');
  IF raw_secret = '' THEN
    RETURN false;
  END IF;
  SELECT value_hash INTO expected_hash
  FROM rr_private.app_config
  WHERE key = 'worker_secret_hash';
  IF expected_hash IS NULL THEN
    RETURN false;
  END IF;
  RETURN encode(sha256(convert_to(raw_secret, 'UTF8')), 'hex') = expected_hash;
END;
$$;

CREATE OR REPLACE FUNCTION rr_private.verify_resource_key(p_type text, p_resource_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = rr_private, public, pg_catalog
AS $$
DECLARE
  raw_key text;
  stored_hash text;
BEGIN
  IF NOT rr_private.is_trusted_worker() THEN
    RETURN false;
  END IF;
  raw_key := rr_private.request_header('x-operator-key');
  IF raw_key = '' THEN
    RETURN false;
  END IF;
  SELECT key_hash INTO stored_hash
  FROM public.rr_secrets
  WHERE resource_type = p_type AND resource_id = p_resource_id;
  IF stored_hash IS NULL THEN
    RETURN false;
  END IF;
  RETURN encode(sha256(convert_to(raw_key, 'UTF8')), 'hex') = stored_hash;
END;
$$;

REVOKE ALL ON SCHEMA rr_private FROM PUBLIC;
GRANT USAGE ON SCHEMA rr_private TO anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA rr_private FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION rr_private.request_header(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rr_private.is_trusted_worker() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rr_private.verify_resource_key(text, uuid) TO anon, authenticated;

-- ============================================================================
-- 4. Row Level Security Policies
-- ============================================================================

ALTER TABLE public.rr_blueprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rr_blueprint_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rr_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rr_run_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rr_run_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rr_probe_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rr_secrets ENABLE ROW LEVEL SECURITY;

-- Public Read Policies
CREATE POLICY "rr_blueprints_public_read"
  ON public.rr_blueprints FOR SELECT
  TO anon, authenticated
  USING (is_public = true);

CREATE POLICY "rr_blueprint_steps_public_read"
  ON public.rr_blueprint_steps FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.rr_blueprints b
      WHERE b.id = blueprint_id AND b.is_public = true
    )
  );

CREATE POLICY "rr_runs_read_by_code"
  ON public.rr_runs FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "rr_run_steps_read"
  ON public.rr_run_steps FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "rr_run_events_read"
  ON public.rr_run_events FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "rr_probe_logs_read"
  ON public.rr_probe_logs FOR SELECT
  TO anon, authenticated
  USING (true);

-- Worker-Mediated Write & Verification Policies
CREATE POLICY "rr_blueprints_worker_insert"
  ON public.rr_blueprints FOR INSERT
  TO anon, authenticated
  WITH CHECK (rr_private.is_trusted_worker());

CREATE POLICY "rr_blueprints_worker_update"
  ON public.rr_blueprints FOR UPDATE
  TO anon, authenticated
  USING (rr_private.is_trusted_worker())
  WITH CHECK (rr_private.is_trusted_worker());

CREATE POLICY "rr_blueprint_steps_worker_insert"
  ON public.rr_blueprint_steps FOR INSERT
  TO anon, authenticated
  WITH CHECK (rr_private.is_trusted_worker());

CREATE POLICY "rr_runs_worker_insert"
  ON public.rr_runs FOR INSERT
  TO anon, authenticated
  WITH CHECK (rr_private.is_trusted_worker());

CREATE POLICY "rr_runs_worker_update"
  ON public.rr_runs FOR UPDATE
  TO anon, authenticated
  USING (rr_private.verify_resource_key('run', id))
  WITH CHECK (rr_private.verify_resource_key('run', id));

CREATE POLICY "rr_run_steps_worker_insert"
  ON public.rr_run_steps FOR INSERT
  TO anon, authenticated
  WITH CHECK (rr_private.is_trusted_worker());

CREATE POLICY "rr_run_steps_worker_update"
  ON public.rr_run_steps FOR UPDATE
  TO anon, authenticated
  USING (rr_private.verify_resource_key('run', run_id))
  WITH CHECK (rr_private.verify_resource_key('run', run_id));

CREATE POLICY "rr_run_events_worker_insert"
  ON public.rr_run_events FOR INSERT
  TO anon, authenticated
  WITH CHECK (rr_private.is_trusted_worker());

CREATE POLICY "rr_probe_logs_worker_insert"
  ON public.rr_probe_logs FOR INSERT
  TO anon, authenticated
  WITH CHECK (rr_private.verify_resource_key('run', run_id));

CREATE POLICY "rr_secrets_worker_insert"
  ON public.rr_secrets FOR INSERT
  TO anon, authenticated
  WITH CHECK (rr_private.is_trusted_worker());

CREATE POLICY "rr_secrets_worker_verify_select"
  ON public.rr_secrets FOR SELECT
  TO anon, authenticated
  USING (
    rr_private.is_trusted_worker()
    AND key_hash = encode(sha256(convert_to(rr_private.request_header('x-operator-key'), 'UTF8')), 'hex')
  );

-- ============================================================================
-- 5. Enable Supabase Realtime Replication
-- ============================================================================

ALTER PUBLICATION supabase_realtime ADD TABLE public.rr_runs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.rr_run_steps;
ALTER PUBLICATION supabase_realtime ADD TABLE public.rr_run_events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.rr_probe_logs;

-- ============================================================================
-- 6. Seed Default Executable Blueprints
--    NOTE: Update probe_url host below if deploying to a custom domain,
--          or edit probe URLs directly inside the Live Run Room UI.
-- ============================================================================

WITH bp1 AS (
  INSERT INTO public.rr_blueprints (slug, title, summary, category, is_seeded, is_public)
  VALUES (
    'zero-downtime-prod-release',
    'Zero-Downtime Production Release',
    'Coordinated deployment sequence covering pre-flight checks, canary edge probe, migration verification, and rollback readiness.',
    'release',
    true,
    true
  )
  ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title
  RETURNING id
),
bp2 AS (
  INSERT INTO public.rr_blueprints (slug, title, summary, category, is_seeded, is_public)
  VALUES (
    'api-outage-incident-triage',
    'API Latency & 5xx Incident Triage',
    'Structured incident response runbook with automated edge health verification, mitigation branching, and stakeholder updates.',
    'incident',
    true,
    true
  )
  ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title
  RETURNING id
),
bp3 AS (
  INSERT INTO public.rr_blueprints (slug, title, summary, category, is_seeded, is_public)
  VALUES (
    'live-broadcast-showcaller',
    'Live Broadcast & Stream Showcaller',
    'Minute-by-minute technical cue sheet for livestream producers, audio engineers, and stage moderators.',
    'broadcast',
    true,
    true
  )
  ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title
  RETURNING id
)
INSERT INTO public.rr_blueprint_steps (
  blueprint_id, position, title, step_type, owner_role, expected_seconds, instructions,
  probe_url, probe_method, probe_expected_status, probe_match_text, rollback_note
)
SELECT id, 1, 'Verify DB Backup & Migration Lock', 'manual', 'DB Ops', 120,
  'Confirm latest automated snapshot succeeded and no long-running DDL locks remain active on primary tables.',
  NULL::text, NULL::text, NULL::integer, NULL::text,
  'Abort deploy window immediately if snapshot age > 15m or active table lock > 30s.'
FROM bp1
UNION ALL
SELECT id, 2, 'Deploy Worker & Assets to Production Edge', 'manual', 'Release Lead', 180,
  'Push tagged release commit and confirm edge bundle upload completes without warnings.',
  NULL::text, NULL::text, NULL::integer, NULL::text,
  'Re-activate previous worker script version from deployment history.'
FROM bp1
UNION ALL
SELECT id, 3, 'Edge Probe: Production Health Endpoint', 'http_probe', 'QA / SRE', 45,
  'Execute live HTTP probe from Cloudflare edge to verify 200 OK status and healthy JSON payload.',
  'https://httpbin.org/status/200', 'GET', 200, NULL::text,
  'If probe returns non-200 or latency > 1500ms, halt traffic shift and roll back worker.'
FROM bp1
UNION ALL
SELECT id, 4, 'Canary Error-Rate & Auth Flow Gate', 'decision', 'Release Lead', 90,
  'Inspect realtime logs for 4xx/5xx spikes over 2 minutes before declaring release green.',
  NULL::text, NULL::text, NULL::integer, NULL::text,
  'Toggle feature flag off and revert edge route to previous release.'
FROM bp1
UNION ALL
SELECT id, 5, 'Publish Release Note & Close Window', 'manual', 'Release Lead', 60,
  'Export this run audit report to team channel and mark release window closed.',
  NULL::text, NULL::text, NULL::integer, NULL::text,
  'Document any follow-up action items in postmortem.'
FROM bp1

UNION ALL
SELECT id, 1, 'Confirm Incident Commander & Comms Channel', 'manual', 'Incident Lead', 60,
  'Claim command role and pin this live run link in the incident war-room so observers stop asking for status.',
  NULL::text, NULL::text, NULL::integer, NULL::text,
  'Assign backup commander if primary lead is unreachable within 2 minutes.'
FROM bp2
UNION ALL
SELECT id, 2, 'Edge Probe: Reproduce Degraded Upstream', 'http_probe', 'On-Call SRE', 45,
  'Run simulated degraded probe first, or replace URL with affected endpoint to capture baseline status and latency.',
  'https://httpbin.org/status/503', 'GET', 200, NULL::text,
  'Expected to fail during active outage; confirms external reachability symptom and edge colo.'
FROM bp2
UNION ALL
SELECT id, 3, 'Mitigation Decision: Rollback vs Rate-Limit', 'decision', 'Incident Lead', 120,
  'Check whether error started right after recent deploy (rollback) or from traffic spike (enable edge rate-limit).',
  NULL::text, NULL::text, NULL::integer, NULL::text,
  'If uncertain after 2 minutes, default to rolling back the latest change.'
FROM bp2
UNION ALL
SELECT id, 4, 'Edge Probe: Verify Recovery Baseline', 'http_probe', 'On-Call SRE', 45,
  'Re-probe healthy endpoint after mitigation to confirm 200 OK and stabilized latency.',
  'https://httpbin.org/status/200', 'GET', 200, NULL::text,
  'Escalate to secondary infrastructure owner if recovery probe still fails.'
FROM bp2

UNION ALL
SELECT id, 1, 'Pre-Flight Audio & Encoder Bitrate Check', 'manual', 'Audio / Video Tech', 180,
  'Verify -14 LUFS audio ceiling, backup mic battery > 80%, and 6000 kbps stable ingest.',
  NULL::text, NULL::text, NULL::integer, NULL::text,
  'Switch to backup USB audio interface and 4000 kbps fallback profile.'
FROM bp3
UNION ALL
SELECT id, 2, 'Edge Probe: Verify Companion Landing Page', 'http_probe', 'Stream Producer', 30,
  'Confirm public event registration/stream landing endpoint responds 200 OK before going live.',
  'https://httpbin.org/status/200', 'GET', 200, NULL::text,
  'Pin direct stream URL backup in community announcement channel.'
FROM bp3
UNION ALL
SELECT id, 3, 'Cue 01: Opening Bumper & Host Mic Live', 'manual', 'Showcaller', 60,
  'Drop countdown slate, unmute Host channel 1, and trigger lower-third title card.',
  NULL::text, NULL::text, NULL::integer, NULL::text,
  'Hold holding-slate 30s if host mic shows zero signal.'
FROM bp3
UNION ALL
SELECT id, 4, 'Cue 02: Audience Q&A Bridge & Wrap-Up', 'manual', 'Moderator', 180,
  'Feed top 3 audience questions to stage screen, cue closing slide, and archive stream recording.',
  NULL::text, NULL::text, NULL::integer, NULL::text,
  'Skip live Q&A and move directly to closing remarks if overrun > 5 minutes.'
FROM bp3
ON CONFLICT (blueprint_id, position) DO NOTHING;

-- ============================================================================
-- 7. Register Your Cloudflare Worker Secret Hash (REQUIRED!)
--    Generate a secret locally (e.g. `openssl rand -hex 32`), hash it with
--    SHA-256, and run the statement below with your 64-char hex hash:
-- ============================================================================
-- INSERT INTO rr_private.app_config (key, value_hash)
-- VALUES ('worker_secret_hash', '<YOUR_64_CHAR_SHA256_HEX>')
-- ON CONFLICT (key) DO UPDATE SET value_hash = EXCLUDED.value_hash, updated_at = now();
