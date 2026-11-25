import { Hono } from 'hono';
import {
  Blueprint,
  BlueprintCategory,
  BlueprintStep,
  BlueprintStepInput,
  ProbeLog,
  Run,
  RunEvent,
  RunStep,
  StepType
} from '../shared/types';
import {
  enforceRateLimit,
  generateRunCode,
  generateToken,
  sanitizeSlug,
  sha256Hex,
  validatePublicProbeUrl
} from './security';
import { SupabaseRestClient } from './supabase';

export interface Env {
  ASSETS: Fetcher;
  RELAYRUN_KV: KVNamespace;
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  RELAYRUN_WORKER_SECRET: string;
}

const VALID_CATEGORIES = new Set<BlueprintCategory>(['release', 'incident', 'broadcast', 'migration', 'custom']);
const VALID_STEP_TYPES = new Set<StepType>(['manual', 'http_probe', 'decision']);

const app = new Hono<{ Bindings: Env }>();

function getClientIp(req: Request): string {
  return req.headers.get('CF-Connecting-IP') ?? req.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ?? 'local';
}

function getDb(env: Env): SupabaseRestClient {
  return new SupabaseRestClient({
    SUPABASE_URL: env.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: env.SUPABASE_PUBLISHABLE_KEY,
    RELAYRUN_WORKER_SECRET: env.RELAYRUN_WORKER_SECRET
  });
}

function cleanText(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

function validateStepsInput(rawSteps: unknown): { ok: true; steps: BlueprintStepInput[] } | { ok: false; error: string } {
  if (!Array.isArray(rawSteps) || rawSteps.length === 0 || rawSteps.length > 25) {
    return { ok: false, error: 'Runbook must contain between 1 and 25 steps.' };
  }

  const normalized: BlueprintStepInput[] = [];
  for (let i = 0; i < rawSteps.length; i++) {
    const s = rawSteps[i] as Record<string, unknown>;
    const title = cleanText(s?.title, 140);
    if (title.length < 2) {
      return { ok: false, error: `Step ${i + 1}: title must be at least 2 characters.` };
    }
    const stepType = (typeof s?.step_type === 'string' ? s.step_type : 'manual') as StepType;
    if (!VALID_STEP_TYPES.has(stepType)) {
      return { ok: false, error: `Step ${i + 1}: invalid step_type.` };
    }
    const ownerRole = cleanText(s?.owner_role, 40) || 'Operator';
    const rawExpected = Number(s?.expected_seconds);
    const expectedSeconds = Number.isFinite(rawExpected)
      ? Math.min(86400, Math.max(10, Math.round(rawExpected)))
      : 120;
    const instructions = cleanText(s?.instructions, 1500);
    const rollbackNote = cleanText(s?.rollback_note, 600);

    let probeUrl: string | null = null;
    let probeMethod: 'GET' | 'HEAD' | null = null;
    let probeExpectedStatus: number | null = null;
    let probeMatchText: string | null = null;

    if (stepType === 'http_probe') {
      const urlCheck = validatePublicProbeUrl(cleanText(s?.probe_url, 500));
      if (!urlCheck.ok) {
        return { ok: false, error: `Step ${i + 1}: ${urlCheck.error}` };
      }
      probeUrl = urlCheck.url.toString();
      probeMethod = s?.probe_method === 'HEAD' ? 'HEAD' : 'GET';
      const statusNum = Number(s?.probe_expected_status);
      probeExpectedStatus = Number.isFinite(statusNum) && statusNum >= 100 && statusNum <= 599 ? Math.round(statusNum) : 200;
      const match = cleanText(s?.probe_match_text, 120);
      probeMatchText = match || null;
    }

    normalized.push({
      title,
      step_type: stepType,
      owner_role: ownerRole,
      expected_seconds: expectedSeconds,
      instructions,
      probe_url: probeUrl,
      probe_method: probeMethod,
      probe_expected_status: probeExpectedStatus,
      probe_match_text: probeMatchText,
      rollback_note: rollbackNote
    });
  }

  return { ok: true, steps: normalized };
}

async function verifyOperatorKey(db: SupabaseRestClient, runId: string, operatorKey: string): Promise<boolean> {
  if (!operatorKey || operatorKey.length < 16) return false;
  const rows = await db.request<Array<{ id: string }>>(
    `rr_secrets?resource_type=eq.run&resource_id=eq.${encodeURIComponent(runId)}&select=id&limit=1`,
    {
      method: 'GET',
      operatorKey
    }
  );
  return Array.isArray(rows) && rows.length === 1;
}

app.get('/api/health', (c) => {
  const cf = (c.req.raw as Request & { cf?: { colo?: string; country?: string } }).cf;
  return c.json({
    ok: true,
    service: 'relayrun-worker',
    colo: cf?.colo ?? 'EDGE',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/demo-health', (c) => {
  const mode = c.req.query('mode');
  const cf = (c.req.raw as Request & { cf?: { colo?: string } }).cf;
  if (mode === 'degraded') {
    return c.json(
      {
        status: 'degraded',
        upstream: 'simulated-checkout-db',
        error: 'connection pool saturation (simulated demo)',
        colo: cf?.colo ?? 'EDGE',
        timestamp: new Date().toISOString()
      },
      503
    );
  }
  return c.json({
    status: 'ok',
    service: 'relayrun-edge-target',
    colo: cf?.colo ?? 'EDGE',
    uptime: 'healthy',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/blueprints', async (c) => {
  const db = getDb(c.env);
  const blueprints = await db.request<Blueprint[]>(
    'rr_blueprints?is_public=eq.true&order=is_seeded.desc,run_count.desc,created_at.desc&limit=40'
  );
  const steps = await db.request<BlueprintStep[]>(
    'rr_blueprint_steps?order=position.asc'
  );
  const stepMap = new Map<string, BlueprintStep[]>();
  for (const st of steps) {
    const list = stepMap.get(st.blueprint_id) ?? [];
    list.push(st);
    stepMap.set(st.blueprint_id, list);
  }
  const enriched = blueprints.map((bp) => ({
    ...bp,
    steps: stepMap.get(bp.id) ?? []
  }));
  return c.json({ blueprints: enriched });
});

app.get('/api/blueprints/:slug', async (c) => {
  const slug = cleanText(c.req.param('slug'), 80);
  const db = getDb(c.env);
  const rows = await db.request<Blueprint[]>(
    `rr_blueprints?slug=eq.${encodeURIComponent(slug)}&limit=1`
  );
  if (!rows.length) return c.json({ error: 'Blueprint not found.' }, 404);
  const bp = rows[0];
  const steps = await db.request<BlueprintStep[]>(
    `rr_blueprint_steps?blueprint_id=eq.${bp.id}&order=position.asc`
  );
  return c.json({ blueprint: { ...bp, steps } });
});

app.post('/api/blueprints', async (c) => {
  const rl = await enforceRateLimit(c.env.RELAYRUN_KV, 'create_bp', getClientIp(c.req.raw), 20, 3600);
  if (!rl.allowed) {
    return c.json({ error: 'Rate limit exceeded. Try again later.' }, 429);
  }

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON payload.' }, 400);
  }

  const title = cleanText(body.title, 120);
  if (title.length < 3) {
    return c.json({ error: 'Blueprint title must be at least 3 characters.' }, 400);
  }
  const summary = cleanText(body.summary, 400);
  const category = (typeof body.category === 'string' ? body.category : 'custom') as BlueprintCategory;
  if (!VALID_CATEGORIES.has(category)) {
    return c.json({ error: 'Invalid blueprint category.' }, 400);
  }
  const forkedFromId = typeof body.forked_from_id === 'string' && body.forked_from_id.length === 36 ? body.forked_from_id : null;

  const stepsCheck = validateStepsInput(body.steps);
  if (!stepsCheck.ok) {
    return c.json({ error: stepsCheck.error }, 400);
  }

  const db = getDb(c.env);
  const slug = sanitizeSlug(title);
  const editKey = generateToken(20);
  const keyHash = await sha256Hex(editKey);

  const created = await db.request<Blueprint[]>('rr_blueprints', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      slug,
      title,
      summary,
      category,
      is_seeded: false,
      is_public: true,
      forked_from_id: forkedFromId
    }
  });
  const blueprint = created[0];

  await db.request('rr_secrets', {
    method: 'POST',
    body: {
      resource_type: 'blueprint',
      resource_id: blueprint.id,
      key_hash: keyHash
    }
  });

  const insertedSteps = await db.request<BlueprintStep[]>('rr_blueprint_steps', {
    method: 'POST',
    prefer: 'return=representation',
    body: stepsCheck.steps.map((s, idx) => ({
      blueprint_id: blueprint.id,
      position: idx + 1,
      ...s
    }))
  });

  return c.json({ blueprint: { ...blueprint, steps: insertedSteps }, editKey }, 201);
});

app.post('/api/runs', async (c) => {
  const rl = await enforceRateLimit(c.env.RELAYRUN_KV, 'create_run', getClientIp(c.req.raw), 30, 3600);
  if (!rl.allowed) {
    return c.json({ error: 'Rate limit exceeded for launching runs. Try again later.' }, 429);
  }

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON payload.' }, 400);
  }

  const db = getDb(c.env);
  const actorAlias = cleanText(body.actor_alias, 40) || 'Lead Operator';
  const envLabel = cleanText(body.environment_label, 40) || 'Production';

  let blueprintId: string | null = null;
  let runTitle = cleanText(body.title, 140);
  let stepsToClone: BlueprintStepInput[] = [];

  if (typeof body.blueprint_id === 'string' && body.blueprint_id.length === 36) {
    const bps = await db.request<Blueprint[]>(
      `rr_blueprints?id=eq.${encodeURIComponent(body.blueprint_id)}&limit=1`
    );
    if (!bps.length) {
      return c.json({ error: 'Referenced blueprint not found.' }, 404);
    }
    const bp = bps[0];
    blueprintId = bp.id;
    if (!runTitle || runTitle.length < 3) {
      runTitle = bp.title;
    }
    const bpSteps = await db.request<BlueprintStep[]>(
      `rr_blueprint_steps?blueprint_id=eq.${bp.id}&order=position.asc`
    );
    stepsToClone = bpSteps.map((s) => ({
      title: s.title,
      step_type: s.step_type,
      owner_role: s.owner_role,
      expected_seconds: s.expected_seconds,
      instructions: s.instructions,
      probe_url: s.probe_url,
      probe_method: s.probe_method,
      probe_expected_status: s.probe_expected_status,
      probe_match_text: s.probe_match_text,
      rollback_note: s.rollback_note
    }));

    // Increment run_count best-effort
    await db.request(`rr_blueprints?id=eq.${bp.id}`, {
      method: 'PATCH',
      body: { run_count: bp.run_count + 1, updated_at: new Date().toISOString() }
    });
  } else {
    if (runTitle.length < 3) {
      return c.json({ error: 'Run title must be at least 3 characters.' }, 400);
    }
    const check = validateStepsInput(body.steps);
    if (!check.ok) {
      return c.json({ error: check.error }, 400);
    }
    stepsToClone = check.steps;
  }

  if (stepsToClone.length === 0) {
    return c.json({ error: 'Cannot launch an empty runbook.' }, 400);
  }

  const runCode = generateRunCode();
  const operatorKey = generateToken(20);
  const keyHash = await sha256Hex(operatorKey);

  const createdRuns = await db.request<Run[]>('rr_runs', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      run_code: runCode,
      blueprint_id: blueprintId,
      title: runTitle,
      environment_label: envLabel,
      status: 'active',
      created_by_alias: actorAlias
    }
  });
  const run = createdRuns[0];

  await db.request('rr_secrets', {
    method: 'POST',
    body: {
      resource_type: 'run',
      resource_id: run.id,
      key_hash: keyHash
    }
  });

  const createdSteps = await db.request<RunStep[]>('rr_run_steps', {
    method: 'POST',
    prefer: 'return=representation',
    body: stepsToClone.map((s, idx) => ({
      run_id: run.id,
      position: idx + 1,
      title: s.title,
      step_type: s.step_type,
      owner_role: s.owner_role,
      expected_seconds: s.expected_seconds,
      instructions: s.instructions,
      probe_url: s.probe_url ?? null,
      probe_method: s.probe_method ?? null,
      probe_expected_status: s.probe_expected_status ?? null,
      probe_match_text: s.probe_match_text ?? null,
      rollback_note: s.rollback_note,
      status: idx === 0 ? 'in_progress' : 'pending',
      started_at: idx === 0 ? new Date().toISOString() : null,
      claimed_by: idx === 0 ? actorAlias : null
    }))
  });

  await db.request('rr_run_events', {
    method: 'POST',
    body: {
      run_id: run.id,
      step_id: createdSteps[0]?.id ?? null,
      actor_alias: actorAlias,
      event_type: 'run_started',
      message: `Launched live run "${run.title}" in ${envLabel}. Cue #01 auto-started.`
    }
  });

  return c.json({ run, steps: createdSteps, operatorKey }, 201);
});

app.get('/api/runs/:code', async (c) => {
  const code = cleanText(c.req.param('code'), 16).toUpperCase();
  const db = getDb(c.env);
  const runs = await db.request<Run[]>(
    `rr_runs?run_code=eq.${encodeURIComponent(code)}&limit=1`
  );
  if (!runs.length) {
    return c.json({ error: 'Live run not found.' }, 404);
  }
  const run = runs[0];
  const operatorKey = cleanText(c.req.header('X-Operator-Key'), 128);

  const [steps, events, probeLogs, canOperate] = await Promise.all([
    db.request<RunStep[]>(`rr_run_steps?run_id=eq.${run.id}&order=position.asc`),
    db.request<RunEvent[]>(`rr_run_events?run_id=eq.${run.id}&order=created_at.desc&limit=150`),
    db.request<ProbeLog[]>(`rr_probe_logs?run_id=eq.${run.id}&order=created_at.desc&limit=60`),
    operatorKey ? verifyOperatorKey(db, run.id, operatorKey) : Promise.resolve(false)
  ]);

  return c.json({ run, steps, events, probeLogs, canOperate });
});

app.post('/api/runs/:code/verify-key', async (c) => {
  const code = cleanText(c.req.param('code'), 16).toUpperCase();
  const db = getDb(c.env);
  const runs = await db.request<Run[]>(`rr_runs?run_code=eq.${encodeURIComponent(code)}&limit=1`);
  if (!runs.length) return c.json({ error: 'Run not found.' }, 404);
  const operatorKey = cleanText(c.req.header('X-Operator-Key'), 128);
  const valid = await verifyOperatorKey(db, runs[0].id, operatorKey);
  return c.json({ valid });
});

app.patch('/api/runs/:code', async (c) => {
  const code = cleanText(c.req.param('code'), 16).toUpperCase();
  const operatorKey = cleanText(c.req.header('X-Operator-Key'), 128);
  const db = getDb(c.env);

  const runs = await db.request<Run[]>(`rr_runs?run_code=eq.${encodeURIComponent(code)}&limit=1`);
  if (!runs.length) return c.json({ error: 'Run not found.' }, 404);
  const run = runs[0];

  const authorized = await verifyOperatorKey(db, run.id, operatorKey);
  if (!authorized) {
    return c.json({ error: 'Operator key missing or invalid. You are in Read-Only Observer mode.' }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON payload.' }, 400);
  }

  const action = cleanText(body.action, 20);
  const actorAlias = cleanText(body.actor_alias, 40) || 'Operator';
  const now = new Date();
  const nowIso = now.toISOString();

  let patchBody: Record<string, unknown> = {};
  let eventType = '';
  let message = '';

  if (action === 'pause' && run.status === 'active') {
    patchBody = { status: 'paused', paused_at: nowIso };
    eventType = 'run_paused';
    message = `${actorAlias} paused the run stopwatch.`;
  } else if (action === 'resume' && run.status === 'paused') {
    const pausedMs = run.paused_at ? Math.max(0, now.getTime() - new Date(run.paused_at).getTime()) : 0;
    patchBody = {
      status: 'active',
      paused_at: null,
      paused_accumulated_ms: Number(run.paused_accumulated_ms) + pausedMs
    };
    eventType = 'run_resumed';
    message = `${actorAlias} resumed live execution.`;
  } else if (action === 'complete' && (run.status === 'active' || run.status === 'paused')) {
    const extraPaused =
      run.status === 'paused' && run.paused_at
        ? Math.max(0, now.getTime() - new Date(run.paused_at).getTime())
        : 0;
    patchBody = {
      status: 'completed',
      ended_at: nowIso,
      paused_at: null,
      paused_accumulated_ms: Number(run.paused_accumulated_ms) + extraPaused
    };
    eventType = 'run_completed';
    message = `${actorAlias} marked this run COMPLETED.`;
  } else if (action === 'abort' && (run.status === 'active' || run.status === 'paused')) {
    patchBody = { status: 'aborted', ended_at: nowIso, paused_at: null };
    eventType = 'run_aborted';
    message = `${actorAlias} ABORTED this run.`;
  } else {
    return c.json({ error: `Cannot apply action "${action}" while run is "${run.status}".` }, 400);
  }

  const updated = await db.request<Run[]>(`rr_runs?id=eq.${run.id}`, {
    method: 'PATCH',
    body: patchBody,
    operatorKey,
    prefer: 'return=representation'
  });

  await db.request('rr_run_events', {
    method: 'POST',
    body: {
      run_id: run.id,
      actor_alias: actorAlias,
      event_type: eventType,
      message
    }
  });

  return c.json({ run: updated[0] });
});

app.post('/api/runs/:code/steps/:stepId/action', async (c) => {
  const code = cleanText(c.req.param('code'), 16).toUpperCase();
  const stepId = cleanText(c.req.param('stepId'), 36);
  const operatorKey = cleanText(c.req.header('X-Operator-Key'), 128);
  const db = getDb(c.env);

  const runs = await db.request<Run[]>(`rr_runs?run_code=eq.${encodeURIComponent(code)}&limit=1`);
  if (!runs.length) return c.json({ error: 'Run not found.' }, 404);
  const run = runs[0];

  const authorized = await verifyOperatorKey(db, run.id, operatorKey);
  if (!authorized) {
    return c.json({ error: 'Operator key missing or invalid.' }, 403);
  }
  if (run.status === 'completed' || run.status === 'aborted') {
    return c.json({ error: `Run is already ${run.status}.` }, 400);
  }

  const steps = await db.request<RunStep[]>(
    `rr_run_steps?id=eq.${encodeURIComponent(stepId)}&run_id=eq.${run.id}&limit=1`
  );
  if (!steps.length) return c.json({ error: 'Step not found.' }, 404);
  const step = steps[0];

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON payload.' }, 400);
  }

  const action = cleanText(body.action, 20);
  const actorAlias = cleanText(body.actor_alias, 40) || 'Operator';
  const note = cleanText(body.note, 600);
  const now = new Date();
  const nowIso = now.toISOString();

  const patch: Record<string, unknown> = {};
  let eventType = '';
  let eventMessage = '';
  const padPos = String(step.position).padStart(2, '0');

  if (action === 'claim') {
    patch.claimed_by = actorAlias;
    eventType = 'step_claimed';
    eventMessage = `${actorAlias} claimed Cue #${padPos} (${step.title}).`;
  } else if (action === 'start') {
    patch.status = 'in_progress';
    patch.claimed_by = step.claimed_by ?? actorAlias;
    patch.started_at = step.started_at ?? nowIso;
    patch.completed_at = null;
    eventType = 'step_started';
    eventMessage = `${actorAlias} started Cue #${padPos}: ${step.title}.`;
  } else if (action === 'pass' || action === 'fail' || action === 'skip') {
    const startRef = step.started_at ? new Date(step.started_at).getTime() : now.getTime();
    const elapsedSec = Math.max(1, Math.round((now.getTime() - startRef) / 1000));
    patch.status = action === 'pass' ? 'passed' : action === 'fail' ? 'failed' : 'skipped';
    patch.claimed_by = step.claimed_by ?? actorAlias;
    patch.started_at = step.started_at ?? nowIso;
    patch.completed_at = nowIso;
    patch.actual_seconds = elapsedSec;
    if (note) patch.operator_note = note;
    eventType = action === 'pass' ? 'step_passed' : action === 'fail' ? 'step_failed' : 'step_skipped';
    const label = action === 'pass' ? 'completed' : action === 'fail' ? 'flagged FAILED' : 'skipped';
    eventMessage = `${actorAlias} ${label} Cue #${padPos} in ${elapsedSec}s${note ? ` — "${note}"` : '.'}`;
  } else if (action === 'reopen') {
    patch.status = 'in_progress';
    patch.completed_at = null;
    patch.actual_seconds = null;
    patch.started_at = nowIso;
    eventType = 'step_reopened';
    eventMessage = `${actorAlias} reopened Cue #${padPos}.`;
  } else if (action === 'note') {
    if (!note) return c.json({ error: 'Note text cannot be empty.' }, 400);
    patch.operator_note = note;
    eventType = 'note_added';
    eventMessage = `${actorAlias} noted on Cue #${padPos}: "${note}"`;
  } else {
    return c.json({ error: 'Unsupported step action.' }, 400);
  }

  const updated = await db.request<RunStep[]>(`rr_run_steps?id=eq.${step.id}`, {
    method: 'PATCH',
    body: patch,
    operatorKey,
    prefer: 'return=representation'
  });

  // Auto-advance next pending step if current step passed or skipped
  if (action === 'pass' || action === 'skip') {
    const allSteps = await db.request<RunStep[]>(
      `rr_run_steps?run_id=eq.${run.id}&order=position.asc`
    );
    const nextPending = allSteps.find((s) => s.position > step.position && s.status === 'pending');
    if (nextPending) {
      await db.request(`rr_run_steps?id=eq.${nextPending.id}`, {
        method: 'PATCH',
        body: { status: 'in_progress', started_at: nowIso },
        operatorKey
      });
    }
  }

  await db.request('rr_run_events', {
    method: 'POST',
    body: {
      run_id: run.id,
      step_id: step.id,
      actor_alias: actorAlias,
      event_type: eventType,
      message: eventMessage
    }
  });

  return c.json({ step: updated[0] });
});

app.post('/api/runs/:code/steps/:stepId/probe', async (c) => {
  const rl = await enforceRateLimit(c.env.RELAYRUN_KV, 'edge_probe', getClientIp(c.req.raw), 45, 600);
  if (!rl.allowed) {
    return c.json({ error: 'Edge probe rate limit exceeded. Wait a moment.' }, 429);
  }

  const code = cleanText(c.req.param('code'), 16).toUpperCase();
  const stepId = cleanText(c.req.param('stepId'), 36);
  const operatorKey = cleanText(c.req.header('X-Operator-Key'), 128);
  const db = getDb(c.env);

  const runs = await db.request<Run[]>(`rr_runs?run_code=eq.${encodeURIComponent(code)}&limit=1`);
  if (!runs.length) return c.json({ error: 'Run not found.' }, 404);
  const run = runs[0];

  const authorized = await verifyOperatorKey(db, run.id, operatorKey);
  if (!authorized) {
    return c.json({ error: 'Operator key missing or invalid.' }, 403);
  }

  const steps = await db.request<RunStep[]>(
    `rr_run_steps?id=eq.${encodeURIComponent(stepId)}&run_id=eq.${run.id}&limit=1`
  );
  if (!steps.length) return c.json({ error: 'Step not found.' }, 404);
  const step = steps[0];

  let body: Record<string, unknown> = {};
  try {
    body = await c.req.json();
  } catch {
    // Allow empty body to use step's saved probe_url
  }

  const actorAlias = cleanText(body.actor_alias, 40) || 'Operator';
  const targetUrlRaw = cleanText(body.override_url, 500) || step.probe_url || '';
  const urlCheck = validatePublicProbeUrl(targetUrlRaw);
  if (!urlCheck.ok) {
    return c.json({ error: urlCheck.error }, 400);
  }

  const method: 'GET' | 'HEAD' = step.probe_method === 'HEAD' ? 'HEAD' : 'GET';
  const expectedStatus = step.probe_expected_status ?? 200;
  const matchText = step.probe_match_text ?? null;
  const cf = (c.req.raw as Request & { cf?: { colo?: string } }).cf;
  const edgeColo = cf?.colo ?? 'EDGE';

  const startMs = Date.now();
  let statusCode: number | null = null;
  let snippet: string | null = null;
  let errorMessage: string | null = null;
  let matched = false;

  try {
    // Self-target /api/demo-health fast-path or external fetch (still safe via validated URL)
    const targetUrl = urlCheck.url;
    const reqUrl = new URL(c.req.url);
    let response: Response;

    if (targetUrl.hostname === reqUrl.hostname && targetUrl.pathname.startsWith('/api/demo-health')) {
      const mode = targetUrl.searchParams.get('mode');
      response = mode === 'degraded'
        ? new Response(JSON.stringify({ status: 'degraded', error: 'connection pool saturation', colo: edgeColo }), {
            status: 503,
            headers: { 'content-type': 'application/json' }
          })
        : new Response(JSON.stringify({ status: 'ok', service: 'relayrun-edge-target', colo: edgeColo }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          });
    } else {
      response = await fetch(targetUrl.toString(), {
        method,
        redirect: 'manual',
        signal: AbortSignal.timeout(5000),
        headers: {
          'User-Agent': 'RelayRun-EdgeProbe/1.0 (+https://relayrun.mfsavana.web.id)',
          Accept: 'application/json, text/plain, */*'
        }
      });
    }

    statusCode = response.status;
    if (method !== 'HEAD') {
      const text = await response.text();
      snippet = text.slice(0, 500);
    }

    const statusOk = statusCode === expectedStatus;
    const bodyOk = !matchText || (snippet !== null && snippet.includes(matchText));
    matched = statusOk && bodyOk;
    if (!statusOk) {
      errorMessage = `Expected HTTP ${expectedStatus}, got ${statusCode}`;
    } else if (!bodyOk) {
      errorMessage = `Expected response to contain "${matchText}"`;
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message.slice(0, 350) : 'Edge fetch failed';
    matched = false;
  }

  const latencyMs = Math.max(1, Date.now() - startMs);
  const nowIso = new Date().toISOString();

  const probeInserted = await db.request<ProbeLog[]>('rr_probe_logs', {
    method: 'POST',
    operatorKey,
    prefer: 'return=representation',
    body: {
      run_id: run.id,
      step_id: step.id,
      target_url: urlCheck.url.toString(),
      method,
      status_code: statusCode,
      latency_ms: latencyMs,
      edge_colo: edgeColo,
      matched,
      response_snippet: snippet,
      error_message: errorMessage
    }
  });

  const stepStartRef = step.started_at ? new Date(step.started_at).getTime() : Date.now();
  const actualSec = Math.max(1, Math.round((Date.now() - stepStartRef) / 1000));
  await db.request(`rr_run_steps?id=eq.${step.id}`, {
    method: 'PATCH',
    operatorKey,
    body: {
      probe_url: urlCheck.url.toString(),
      status: matched ? 'passed' : 'failed',
      claimed_by: step.claimed_by ?? actorAlias,
      started_at: step.started_at ?? nowIso,
      completed_at: nowIso,
      actual_seconds: actualSec
    }
  });

  if (matched) {
    const allSteps = await db.request<RunStep[]>(`rr_run_steps?run_id=eq.${run.id}&order=position.asc`);
    const nextPending = allSteps.find((s) => s.position > step.position && s.status === 'pending');
    if (nextPending) {
      await db.request(`rr_run_steps?id=eq.${nextPending.id}`, {
        method: 'PATCH',
        operatorKey,
        body: { status: 'in_progress', started_at: nowIso }
      });
    }
  }

  const padPos = String(step.position).padStart(2, '0');
  await db.request('rr_run_events', {
    method: 'POST',
    body: {
      run_id: run.id,
      step_id: step.id,
      actor_alias: actorAlias,
      event_type: 'probe_executed',
      message: `Edge Probe [${edgeColo}] on Cue #${padPos}: ${statusCode ?? 'ERR'} in ${latencyMs}ms — ${matched ? 'VERIFIED' : `FAILED (${errorMessage})`}`
    }
  });

  return c.json({ probe: probeInserted[0] });
});

app.post('/api/runs/:code/notes', async (c) => {
  const code = cleanText(c.req.param('code'), 16).toUpperCase();
  const operatorKey = cleanText(c.req.header('X-Operator-Key'), 128);
  const db = getDb(c.env);

  const runs = await db.request<Run[]>(`rr_runs?run_code=eq.${encodeURIComponent(code)}&limit=1`);
  if (!runs.length) return c.json({ error: 'Run not found.' }, 404);
  const run = runs[0];

  const authorized = await verifyOperatorKey(db, run.id, operatorKey);
  if (!authorized) return c.json({ error: 'Operator key missing or invalid.' }, 403);

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON payload.' }, 400);
  }

  const message = cleanText(body.message, 500);
  const actorAlias = cleanText(body.actor_alias, 40) || 'Operator';
  if (!message) return c.json({ error: 'Message cannot be empty.' }, 400);

  const inserted = await db.request<RunEvent[]>('rr_run_events', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      run_id: run.id,
      actor_alias: actorAlias,
      event_type: 'note_added',
      message
    }
  });

  return c.json({ event: inserted[0] }, 201);
});

app.get('/api/runs/:code/export', async (c) => {
  const code = cleanText(c.req.param('code'), 16).toUpperCase();
  const format = c.req.query('format') === 'json' ? 'json' : 'md';
  const db = getDb(c.env);

  const runs = await db.request<Run[]>(`rr_runs?run_code=eq.${encodeURIComponent(code)}&limit=1`);
  if (!runs.length) return c.json({ error: 'Run not found.' }, 404);
  const run = runs[0];

  const [steps, events, probeLogs] = await Promise.all([
    db.request<RunStep[]>(`rr_run_steps?run_id=eq.${run.id}&order=position.asc`),
    db.request<RunEvent[]>(`rr_run_events?run_id=eq.${run.id}&order=created_at.asc`),
    db.request<ProbeLog[]>(`rr_probe_logs?run_id=eq.${run.id}&order=created_at.asc`)
  ]);

  if (format === 'json') {
    return new Response(JSON.stringify({ run, steps, probeLogs, events }, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="relayrun-${run.run_code}.json"`
      }
    });
  }

  const endMs = run.ended_at ? new Date(run.ended_at).getTime() : Date.now();
  const activeMs = Math.max(0, endMs - new Date(run.started_at).getTime() - Number(run.paused_accumulated_ms));
  const totalSec = Math.round(activeMs / 1000);
  const passedCount = steps.filter((s) => s.status === 'passed').length;
  const failedCount = steps.filter((s) => s.status === 'failed').length;
  const slowest = steps
    .filter((s) => s.actual_seconds !== null)
    .sort((a, b) => (b.actual_seconds ?? 0) - (a.actual_seconds ?? 0))[0];

  const lines: string[] = [
    `# RelayRun Post-Run Audit: ${run.title}`,
    '',
    `- **Run Code:** \`${run.run_code}\``,
    `- **Environment:** ${run.environment_label}`,
    `- **Status:** ${run.status.toUpperCase()}`,
    `- **Lead Operator:** ${run.created_by_alias}`,
    `- **Started:** ${run.started_at}`,
    `- **Ended:** ${run.ended_at ?? 'In progress'}`,
    `- **Active Execution Time:** ${totalSec}s`,
    `- **Steps:** ${passedCount}/${steps.length} passed (${failedCount} failed)`,
    slowest ? `- **Bottleneck Step:** Cue #${String(slowest.position).padStart(2, '0')} ${slowest.title} (${slowest.actual_seconds}s vs ${slowest.expected_seconds}s target)` : '',
    '',
    '## Step Execution Ledger',
    '',
    '| Cue | Step | Type | Owner | Status | Actual / Target | Note |',
    '| :--- | :--- | :--- | :--- | :--- | :--- | :--- |',
    ...steps.map((s) => {
      const cue = `#${String(s.position).padStart(2, '0')}`;
      const owner = s.claimed_by || s.owner_role;
      const dur = `${s.actual_seconds ?? '-'}s / ${s.expected_seconds}s`;
      const note = (s.operator_note || '').replace(/\|/g, '/');
      return `| ${cue} | ${s.title.replace(/\|/g, '/')} | ${s.step_type} | ${owner} | ${s.status} | ${dur} | ${note} |`;
    }),
    '',
    '## Edge HTTP Probe Telemetry',
    '',
    probeLogs.length === 0
      ? '_No edge probes executed during this run._'
      : [
          '| Timestamp | Colo | Method | Target | Status | Latency | Verdict |',
          '| :--- | :--- | :--- | :--- | :--- | :--- | :--- |',
          ...probeLogs.map(
            (p) =>
              `| ${p.created_at} | ${p.edge_colo ?? 'EDGE'} | ${p.method} | ${p.target_url} | ${p.status_code ?? 'ERR'} | ${p.latency_ms}ms | ${p.matched ? 'PASS' : 'FAIL'} |`
          )
        ].join('\n'),
    '',
    '## Chronological Event Timeline',
    '',
    ...events.map((e) => `- \`${e.created_at}\` **[${e.actor_alias}]** ${e.message}`)
  ].filter(Boolean);

  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="relayrun-${run.run_code}.md"`
    }
  });
});

app.all('*', async (c) => {
  if (c.req.path.startsWith('/api/')) {
    return c.json({ error: 'API route not found.' }, 404);
  }
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
