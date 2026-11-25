# RelayRun

**Live Executable Runbooks with Edge Probes, Multi-Operator Sync, and Instant Post-Run Audits.**

RelayRun turns static release checklists, incident response SOPs, and broadcast cue sheets into collaborative live execution rooms powered by **Cloudflare Workers + KV** and **Supabase Postgres + Realtime**.

## Key Capabilities

- **Zero-Friction Launch:** Pick a seeded blueprint (Zero-Downtime Release, API Incident Triage, Live Broadcast Showcaller) or build/fork a custom cue sheet and launch a live room in one click—no mandatory signup wall.
- **Serialized Cue Execution:** Every step tracks an explicit owner role, target duration vs. live elapsed timer, claim status, execution notes, and rollback/mitigation guidance.
- **Cloudflare Edge HTTP Probes:** Run real server-side HTTP (`GET`/`HEAD`) health assertions directly from Cloudflare Edge locations, recording HTTP status, response snippet, latency in milliseconds, and serving `cf.colo` in the audit trail.
- **Multiplayer Realtime + Presence:** Multiple engineers or stage operators can join `/run/:code?key=...` simultaneously with live step transitions, timeline updates, and online presence indicators via Supabase Realtime; stakeholders can watch safely via the read-only Observer Link (`/run/:code`).
- **Capability-Isolated Security:** Write operations flow through the Cloudflare Worker API (`x-relayrun-worker` secret + per-run `X-Operator-Key` SHA-256 verification), enforced at the database layer via Postgres Row Level Security (RLS) inside a non-exposed `rr_private` verification schema.
- **One-Click Post-Run Audit Export:** Download a timestamped Markdown postmortem (`.md`) or structured JSON telemetry log (`.json`) including bottleneck step analysis and edge probe history.

## Architecture

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS v4, Lucide Icons.
- **Edge API & Static Assets:** Hono running on Cloudflare Workers (`run_worker_first: ["/api/*"]`), Workers Static Assets, and Cloudflare KV (`RELAYRUN_KV`) for per-IP rate limiting.
- **Database & Sync:** Supabase Postgres (`rr_blueprints`, `rr_blueprint_steps`, `rr_runs`, `rr_run_steps`, `rr_run_events`, `rr_probe_logs`, `rr_secrets`) with RLS enabled on all tables and Supabase Realtime enabled for live room state.
- **SSRF Guard:** Edge HTTP Probes strictly reject loopback, private IPv4/IPv6 ranges, link-local metadata endpoints, obfuscated numeric/hex IP literals, and credentialed URLs.

## Local Development

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env` and fill in your Supabase URL and publishable key:
   ```bash
   cp .env.example .env
   ```
3. Apply the SQL migrations in `supabase/migrations/` to your Supabase project and insert the SHA-256 hash of your chosen `RELAYRUN_WORKER_SECRET` into `rr_private.app_config`.
4. Run typecheck, unit tests, and build:
   ```bash
   npm run typecheck
   npm test
   npm run build
   ```
5. Run locally with Vite + Wrangler:
   ```bash
   npx wrangler dev
   ```
