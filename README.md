# RelayRun

**Live Executable Runbooks with Edge Probes, Multi-Operator Sync, and Instant Post-Run Audits.**

RelayRun turns static release checklists, incident response SOPs, and broadcast cue sheets into collaborative live execution rooms powered by **Cloudflare Workers + KV** and **Supabase Postgres + Realtime**.

---

## Features

- **Zero-Friction Launch:** Pick a seeded blueprint (*Zero-Downtime Production Release*, *API Incident Triage*, *Live Broadcast Showcaller*) or build/fork a custom cue sheet and launch a live room in one click—no mandatory signup wall.
- **Serialized Cue Execution:** Every step tracks an explicit owner role, target duration vs. live elapsed timer, claim status, execution notes, and rollback/mitigation guidance.
- **Cloudflare Edge HTTP Probes:** Run real server-side HTTP (`GET`/`HEAD`) health checks directly from Cloudflare Edge locations, recording HTTP status, response snippet, latency in milliseconds, and serving `cf.colo` in the audit trail. Built-in `/api/demo-health` and `/api/demo-health?mode=degraded` endpoints let you test pass and failure paths immediately.
- **Multiplayer Realtime + Presence:** Multiple engineers or stage operators can join `/run/:code?key=...` simultaneously with live step transitions, timeline updates, and online presence indicators via Supabase Realtime; stakeholders can watch safely via the read-only Observer Link (`/run/:code`).
- **Capability-Isolated Security:** Write operations flow through the Cloudflare Worker API (`x-relayrun-worker` secret + per-run `X-Operator-Key` SHA-256 verification), enforced at the database layer via Postgres Row Level Security (RLS) inside a non-exposed `rr_private` verification schema. No `SUPABASE_SERVICE_ROLE_KEY` is required in the Worker or client.
- **One-Click Post-Run Audit Export:** Download a timestamped Markdown postmortem (`.md`) or structured JSON telemetry log (`.json`) including bottleneck step analysis and edge probe history.

---

## Architecture

| Layer | Technology | Responsibility |
| :--- | :--- | :--- |
| **Frontend** | React 19, TypeScript, Vite, Tailwind CSS v4, Lucide | Tactical Cue Sheet UI, Light/Dark theme, Realtime Presence & Subscriptions |
| **Edge API & Assets** | Hono on Cloudflare Workers + Workers Static Assets | Serves SPA + `/api/*` endpoints (`run_worker_first`), Edge HTTP Probes, Audit Export |
| **Edge Rate Limiting** | Cloudflare KV (`RELAYRUN_KV`) | Per-IP rate limits for blueprint creation, run launching, and edge probes |
| **Database & Sync** | Supabase Postgres 17 + Realtime | `rr_*` tables, strict RLS, `rr_private` capability checks, Realtime `postgres_changes` |

### Anti-SSRF Protection
Edge HTTP Probes (`POST /api/runs/:code/steps/:stepId/probe`) enforce strict URL validation before fetching:
- Only `http://` and `https://` schemes are allowed (no credentials in URLs).
- Rejects `localhost`, `.local`, `.internal`, cloud metadata hosts (`169.254.169.254`, `metadata.google.internal`), private/CGNAT/loopback/multicast IPv4 ranges, ULA/link-local/loopback IPv6 literals, and obfuscated integer/hex/octal IP hosts.
- Uses `redirect: 'manual'` and a 5-second timeout (`AbortSignal.timeout(5000)`).

---

## Self-Hosting Setup Guide

Follow these steps to deploy your own instance of RelayRun on **Supabase** and **Cloudflare Workers**.

### Prerequisites
- Node.js `>= 20` and `npm`
- A free [Supabase](https://supabase.com/) project
- A free [Cloudflare](https://dash.cloudflare.com/) account (`wrangler` CLI)

### Step 1: Clone & Install Dependencies
```bash
git clone https://github.com/Qanz4Ever/relayrun.git
cd relayrun
npm install
```

### Step 2: Generate a Worker Secret Pair
RelayRun isolates database writes so only your Cloudflare Worker can mutate Supabase tables. Generate a random 32-byte secret and its SHA-256 hex digest:

```bash
node -e "
const crypto = require('crypto');
const secret = crypto.randomBytes(32).toString('hex');
const hash = crypto.createHash('sha256').update(secret).digest('hex');
console.log('RELAYRUN_WORKER_SECRET =', secret);
console.log('worker_secret_hash     =', hash);
"
```
Keep both values handy for Step 3 and Step 5.

### Step 3: Configure Supabase Database
1. Open your Supabase project **SQL Editor**.
2. Run the full contents of [`supabase/migrations/001_relayrun_schema.sql`](./supabase/migrations/001_relayrun_schema.sql).
3. Register your `worker_secret_hash` from Step 2 in the private config table:
   ```sql
   INSERT INTO rr_private.app_config (key, value_hash)
   VALUES ('worker_secret_hash', '<YOUR_64_CHAR_SHA256_HEX>')
   ON CONFLICT (key) DO UPDATE SET value_hash = EXCLUDED.value_hash, updated_at = now();
   ```
4. *(Optional)* Update the seeded `probe_url` values in `public.rr_blueprint_steps` to point to your deployed domain's `/api/demo-health` endpoint once live.
5. Copy your **Project URL** (`SUPABASE_URL`) and **Publishable Key** (`sb_publishable_...` or legacy `anon` key) from **Project Settings -> API**.

### Step 4: Configure Environment & Cloudflare KV
1. Create `.env` from `.env.example` for Vite frontend builds and local development:
   ```bash
   cp .env.example .env
   ```
   Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env`.
2. Authenticate Wrangler and create a KV namespace:
   ```bash
   npx wrangler login
   npx wrangler kv namespace create RELAYRUN_KV
   ```
3. Copy the returned `id` into `wrangler.jsonc` under `kv_namespaces[0].id` (replacing `<YOUR_KV_NAMESPACE_ID>`).

### Step 5: Set Cloudflare Worker Vars & Secrets
Configure the Worker runtime bindings on Cloudflare:
```bash
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_PUBLISHABLE_KEY
npx wrangler secret put RELAYRUN_WORKER_SECRET
```
*(Paste `RELAYRUN_WORKER_SECRET` from Step 2—not the hash.)*

For local `wrangler dev`, create a `.dev.vars` file (already ignored by `.gitignore`):
```ini
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key_here
RELAYRUN_WORKER_SECRET=your_raw_worker_secret_from_step_2
```

### Step 6: Verify, Run Locally, & Deploy
```bash
# Typecheck, unit tests (SSRF & crypto), and production build
npm run typecheck
npm test
npm run build

# Optional: run full-stack locally via Wrangler
npx wrangler dev

# Deploy Worker + Static Assets to Cloudflare
npx wrangler deploy
```

Attach a custom domain or route in **Cloudflare Dashboard -> Workers & Pages -> relayrun -> Settings -> Domains & Routes** to serve RelayRun on your own domain.

---

## Project Structure

```text
├── src/
│   ├── client/               # React 19 SPA (DeckHome, LiveRunRoom, CueStepRow, Builder)
│   ├── shared/types.ts       # Shared TypeScript interfaces between Worker and Client
│   └── worker/               # Hono API, Supabase REST adapter, Anti-SSRF & KV rate limits
├── supabase/migrations/      # Full idempotent Postgres DDL, RLS policies, and seed blueprints
├── tests/worker.test.ts      # Node test suite for SSRF guard, hashing, and code generation
├── wrangler.jsonc            # Cloudflare Workers + Static Assets + KV configuration
└── .env.example              # Frontend & Worker environment variable template
```

## License

MIT
