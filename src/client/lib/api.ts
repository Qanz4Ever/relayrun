import {
  Blueprint,
  BlueprintCategory,
  BlueprintStepInput,
  ProbeLog,
  Run,
  RunBundle,
  RunEvent,
  RunStep
} from '../../shared/types';

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }
  return data as T;
}

export async function fetchBlueprints(): Promise<Blueprint[]> {
  const data = await apiFetch<{ blueprints: Blueprint[] }>('/api/blueprints');
  return data.blueprints;
}

export async function createBlueprint(payload: {
  title: string;
  summary: string;
  category: BlueprintCategory;
  forked_from_id?: string | null;
  steps: BlueprintStepInput[];
}): Promise<{ blueprint: Blueprint; editKey: string }> {
  return apiFetch('/api/blueprints', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export async function launchRun(payload: {
  blueprint_id?: string;
  title?: string;
  environment_label: string;
  actor_alias: string;
  steps?: BlueprintStepInput[];
}): Promise<{ run: Run; steps: RunStep[]; operatorKey: string }> {
  return apiFetch('/api/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export async function fetchRunBundle(runCode: string, operatorKey?: string | null): Promise<RunBundle> {
  const headers: Record<string, string> = {};
  if (operatorKey) headers['X-Operator-Key'] = operatorKey;
  return apiFetch(`/api/runs/${encodeURIComponent(runCode)}`, { headers });
}

export async function verifyRunKey(runCode: string, operatorKey: string): Promise<boolean> {
  const data = await apiFetch<{ valid: boolean }>(`/api/runs/${encodeURIComponent(runCode)}/verify-key`, {
    method: 'POST',
    headers: { 'X-Operator-Key': operatorKey }
  });
  return data.valid;
}

export async function updateRunLifecycle(
  runCode: string,
  operatorKey: string,
  action: 'pause' | 'resume' | 'complete' | 'abort',
  actorAlias: string
): Promise<Run> {
  const data = await apiFetch<{ run: Run }>(`/api/runs/${encodeURIComponent(runCode)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-Operator-Key': operatorKey
    },
    body: JSON.stringify({ action, actor_alias: actorAlias })
  });
  return data.run;
}

export async function triggerStepAction(
  runCode: string,
  stepId: string,
  operatorKey: string,
  payload: {
    action: 'claim' | 'start' | 'pass' | 'fail' | 'skip' | 'reopen' | 'note';
    actor_alias: string;
    note?: string;
  }
): Promise<RunStep> {
  const data = await apiFetch<{ step: RunStep }>(
    `/api/runs/${encodeURIComponent(runCode)}/steps/${encodeURIComponent(stepId)}/action`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Operator-Key': operatorKey
      },
      body: JSON.stringify(payload)
    }
  );
  return data.step;
}

export async function runEdgeProbe(
  runCode: string,
  stepId: string,
  operatorKey: string,
  actorAlias: string,
  overrideUrl?: string
): Promise<ProbeLog> {
  const data = await apiFetch<{ probe: ProbeLog }>(
    `/api/runs/${encodeURIComponent(runCode)}/steps/${encodeURIComponent(stepId)}/probe`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Operator-Key': operatorKey
      },
      body: JSON.stringify({ actor_alias: actorAlias, override_url: overrideUrl })
    }
  );
  return data.probe;
}

export async function addRunNote(
  runCode: string,
  operatorKey: string,
  actorAlias: string,
  message: string
): Promise<RunEvent> {
  const data = await apiFetch<{ event: RunEvent }>(`/api/runs/${encodeURIComponent(runCode)}/notes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Operator-Key': operatorKey
    },
    body: JSON.stringify({ actor_alias: actorAlias, message })
  });
  return data.event;
}
