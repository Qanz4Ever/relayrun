export type BlueprintCategory = 'release' | 'incident' | 'broadcast' | 'migration' | 'custom';
export type StepType = 'manual' | 'http_probe' | 'decision';
export type RunStatus = 'active' | 'paused' | 'completed' | 'aborted';
export type StepStatus = 'pending' | 'in_progress' | 'passed' | 'failed' | 'skipped';

export interface Blueprint {
  id: string;
  slug: string;
  title: string;
  summary: string;
  category: BlueprintCategory;
  is_seeded: boolean;
  is_public: boolean;
  forked_from_id: string | null;
  run_count: number;
  created_at: string;
  updated_at: string;
  steps?: BlueprintStep[];
}

export interface BlueprintStep {
  id: string;
  blueprint_id: string;
  position: number;
  title: string;
  step_type: StepType;
  owner_role: string;
  expected_seconds: number;
  instructions: string;
  probe_url: string | null;
  probe_method: 'GET' | 'HEAD' | null;
  probe_expected_status: number | null;
  probe_match_text: string | null;
  rollback_note: string;
}

export interface Run {
  id: string;
  run_code: string;
  blueprint_id: string | null;
  title: string;
  environment_label: string;
  status: RunStatus;
  started_at: string;
  ended_at: string | null;
  paused_accumulated_ms: number;
  paused_at: string | null;
  created_by_alias: string;
  created_at: string;
}

export interface RunStep {
  id: string;
  run_id: string;
  position: number;
  title: string;
  step_type: StepType;
  owner_role: string;
  claimed_by: string | null;
  expected_seconds: number;
  instructions: string;
  probe_url: string | null;
  probe_method: 'GET' | 'HEAD' | null;
  probe_expected_status: number | null;
  probe_match_text: string | null;
  rollback_note: string;
  status: StepStatus;
  started_at: string | null;
  completed_at: string | null;
  actual_seconds: number | null;
  operator_note: string;
}

export interface RunEvent {
  id: string;
  run_id: string;
  step_id: string | null;
  actor_alias: string;
  event_type: string;
  message: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ProbeLog {
  id: string;
  run_id: string;
  step_id: string;
  target_url: string;
  method: 'GET' | 'HEAD';
  status_code: number | null;
  latency_ms: number;
  edge_colo: string | null;
  matched: boolean;
  response_snippet: string | null;
  error_message: string | null;
  created_at: string;
}

export interface RunBundle {
  run: Run;
  steps: RunStep[];
  events: RunEvent[];
  probeLogs: ProbeLog[];
  canOperate: boolean;
}

export interface BlueprintStepInput {
  title: string;
  step_type: StepType;
  owner_role: string;
  expected_seconds: number;
  instructions: string;
  probe_url?: string | null;
  probe_method?: 'GET' | 'HEAD' | null;
  probe_expected_status?: number | null;
  probe_match_text?: string | null;
  rollback_note: string;
}
