import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertOctagon,
  ArrowLeft,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  KeyRound,
  MessageSquarePlus,
  Pause,
  Play,
  Radio,
  ShieldAlert,
  Users
} from 'lucide-react';
import { ProbeLog, Run, RunEvent, RunStep } from '../../shared/types';
import {
  addRunNote,
  fetchRunBundle,
  runEdgeProbe,
  triggerStepAction,
  updateRunLifecycle,
  verifyRunKey
} from '../lib/api';
import { computeElapsedMs, formatDuration, formatTimeShort } from '../lib/format';
import { getOperatorKeyForRun, saveOperatorKeyForRun } from '../lib/localStore';
import { getSupabaseClient } from '../lib/supabase';
import { CueStepRow } from '../components/CueStepRow';

interface LiveRunRoomProps {
  runCode: string;
  alias: string;
  onBackHome: () => void;
}

interface PresenceMember {
  alias: string;
  role: 'operator' | 'observer';
}

export const LiveRunRoom: React.FC<LiveRunRoomProps> = ({ runCode, alias, onBackHome }) => {
  const [run, setRun] = useState<Run | null>(null);
  const [steps, setSteps] = useState<RunStep[]>([]);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [probeLogs, setProbeLogs] = useState<ProbeLog[]>([]);
  const [canOperate, setCanOperate] = useState(false);
  const [operatorKey, setOperatorKey] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('key') || getOperatorKeyForRun(runCode);
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyStepId, setBusyStepId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [noteInput, setNoteInput] = useState('');
  const [manualKeyInput, setManualKeyInput] = useState('');
  const [copiedType, setCopiedType] = useState<'operator' | 'viewer' | null>(null);
  const [onlinePeers, setOnlinePeers] = useState<PresenceMember[]>([]);
  const [realtimeStatus, setRealtimeStatus] = useState<'connecting' | 'live' | 'polling'>('connecting');

  const loadBundle = useCallback(async () => {
    try {
      const bundle = await fetchRunBundle(runCode, operatorKey);
      setRun(bundle.run);
      setSteps(bundle.steps);
      setEvents(bundle.events);
      setProbeLogs(bundle.probeLogs);
      setCanOperate(bundle.canOperate);
      if (bundle.canOperate && operatorKey) {
        saveOperatorKeyForRun(
          bundle.run.run_code,
          bundle.run.title,
          bundle.run.environment_label,
          operatorKey
        );
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load live run');
    } finally {
      setLoading(false);
    }
  }, [runCode, operatorKey]);

  useEffect(() => {
    loadBundle();
  }, [loadBundle]);

  // 1-second stopwatch tick while run is active
  useEffect(() => {
    if (!run || run.status === 'completed' || run.status === 'aborted') return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [run?.status]);

  // Supabase Realtime subscription + Presence
  useEffect(() => {
    if (!run?.id) return;
    const sb = getSupabaseClient();
    if (!sb) {
      setRealtimeStatus('polling');
      return;
    }

    const channel = sb
      .channel(`relayrun:room:${run.id}`, {
        config: {
          presence: { key: `${alias}-${Math.random().toString(36).slice(2, 7)}` }
        }
      })
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rr_runs', filter: `id=eq.${run.id}` },
        (payload) => {
          if (payload.new && typeof payload.new === 'object') {
            setRun(payload.new as Run);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rr_run_steps', filter: `run_id=eq.${run.id}` },
        (payload) => {
          const next = payload.new as RunStep;
          if (!next?.id) return;
          setSteps((prev) => {
            const exists = prev.some((s) => s.id === next.id);
            const merged = exists ? prev.map((s) => (s.id === next.id ? next : s)) : [...prev, next];
            return merged.sort((a, b) => a.position - b.position);
          });
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'rr_run_events', filter: `run_id=eq.${run.id}` },
        (payload) => {
          const next = payload.new as RunEvent;
          if (!next?.id) return;
          setEvents((prev) => (prev.some((e) => e.id === next.id) ? prev : [next, ...prev].slice(0, 150)));
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'rr_probe_logs', filter: `run_id=eq.${run.id}` },
        (payload) => {
          const next = payload.new as ProbeLog;
          if (!next?.id) return;
          setProbeLogs((prev) => (prev.some((p) => p.id === next.id) ? prev : [next, ...prev].slice(0, 60)));
        }
      )
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<PresenceMember>();
        const members: PresenceMember[] = [];
        for (const list of Object.values(state)) {
          for (const entry of list) {
            if (entry?.alias) members.push({ alias: entry.alias, role: entry.role });
          }
        }
        setOnlinePeers(members);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          setRealtimeStatus('live');
          await channel.track({
            alias,
            role: canOperate ? 'operator' : 'observer'
          });
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setRealtimeStatus('polling');
        }
      });

    return () => {
      sb.removeChannel(channel);
    };
  }, [run?.id, alias, canOperate]);

  const elapsedSec = useMemo(() => {
    if (!run) return 0;
    return Math.round(
      computeElapsedMs(
        run.started_at,
        run.ended_at,
        run.status,
        run.paused_at,
        run.paused_accumulated_ms,
        nowMs
      ) / 1000
    );
  }, [run, nowMs]);

  const stats = useMemo(() => {
    const total = steps.length;
    const done = steps.filter((s) => s.status === 'passed' || s.status === 'skipped').length;
    const failed = steps.filter((s) => s.status === 'failed').length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const slowest = steps
      .filter((s) => s.actual_seconds !== null)
      .sort((a, b) => (b.actual_seconds ?? 0) - (a.actual_seconds ?? 0))[0];
    const avgLatency =
      probeLogs.length > 0
        ? Math.round(probeLogs.reduce((sum, p) => sum + p.latency_ms, 0) / probeLogs.length)
        : null;
    return { total, done, failed, pct, slowest, avgLatency };
  }, [steps, probeLogs]);

  const handleLifecycle = async (action: 'pause' | 'resume' | 'complete' | 'abort') => {
    if (!operatorKey || !run) return;
    setActionError(null);
    try {
      const updated = await updateRunLifecycle(run.run_code, operatorKey, action, alias);
      setRun(updated);
      await loadBundle();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Run update failed');
    }
  };

  const handleStepAction = async (
    stepId: string,
    action: 'claim' | 'start' | 'pass' | 'fail' | 'skip' | 'reopen' | 'note',
    note?: string
  ) => {
    if (!operatorKey || !run) return;
    setActionError(null);
    setBusyStepId(stepId);
    try {
      await triggerStepAction(run.run_code, stepId, operatorKey, {
        action,
        actor_alias: alias,
        note
      });
      await loadBundle();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Step action failed');
    } finally {
      setBusyStepId(null);
    }
  };

  const handleRunProbe = async (stepId: string, overrideUrl?: string) => {
    if (!operatorKey || !run) return;
    setActionError(null);
    setBusyStepId(stepId);
    try {
      await runEdgeProbe(run.run_code, stepId, operatorKey, alias, overrideUrl);
      await loadBundle();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Edge probe failed');
    } finally {
      setBusyStepId(null);
    }
  };

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!operatorKey || !run || !noteInput.trim()) return;
    setActionError(null);
    try {
      await addRunNote(run.run_code, operatorKey, alias, noteInput.trim());
      setNoteInput('');
      await loadBundle();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to post note');
    }
  };

  const handleUnlockKey = async (e: React.FormEvent) => {
    e.preventDefault();
    const candidate = manualKeyInput.trim();
    if (!candidate) return;
    setActionError(null);
    try {
      const valid = await verifyRunKey(runCode, candidate);
      if (!valid) {
        setActionError('Invalid Operator Key.');
        return;
      }
      setOperatorKey(candidate);
      setManualKeyInput('');
      const url = new URL(window.location.href);
      url.searchParams.set('key', candidate);
      window.history.replaceState({}, '', url.toString());
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Verification failed');
    }
  };

  const copyShareLink = async (type: 'operator' | 'viewer') => {
    const base = `${window.location.origin}/run/${runCode}`;
    const target = type === 'operator' && operatorKey ? `${base}?key=${operatorKey}` : base;
    await navigator.clipboard.writeText(target);
    setCopiedType(type);
    window.setTimeout(() => setCopiedType(null), 2000);
  };

  if (loading) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="h-32 animate-pulse rounded-md border border-[var(--border)] bg-[var(--surface)]" />
        <div className="mt-6 h-64 animate-pulse rounded-md border border-[var(--border)] bg-[var(--surface)]" />
      </main>
    );
  }

  if (error || !run) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <div className="rounded-md border border-[var(--danger)] bg-[var(--danger-bg)] p-6">
          <h1 className="text-lg font-bold text-[var(--danger)]">Live Run Not Found</h1>
          <p className="mt-1 text-sm text-[var(--text)]">{error ?? 'Check the run code and try again.'}</p>
          <button
            type="button"
            onClick={onBackHome}
            className="mt-4 inline-flex items-center gap-1.5 rounded bg-[var(--primary)] px-3.5 py-2 text-xs font-semibold text-[var(--on-primary)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Blueprints
          </button>
        </div>
      </main>
    );
  }

  const runEnded = run.status === 'completed' || run.status === 'aborted';

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBackHome}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          All Blueprints
        </button>

        <div className="flex items-center gap-2 font-mono-tabular text-xs">
          <span
            className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 ${
              realtimeStatus === 'live'
                ? 'border-[var(--success)]/40 bg-[var(--success-bg)] text-[var(--success)]'
                : 'border-[var(--border)] bg-[var(--surface-recessed)] text-[var(--text-muted)]'
            }`}
          >
            <Radio className="h-3 w-3" aria-hidden="true" />
            {realtimeStatus === 'live' ? 'REALTIME SYNC' : 'SYNC READY'}
          </span>
          {canOperate ? (
            <span className="inline-flex items-center gap-1 rounded bg-[var(--primary)] px-2 py-0.5 font-semibold text-[var(--on-primary)]">
              <KeyRound className="h-3 w-3" aria-hidden="true" />
              OPERATOR MODE
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--surface-recessed)] px-2 py-0.5 text-[var(--text-muted)]">
              <Eye className="h-3 w-3" aria-hidden="true" />
              OBSERVER MODE
            </span>
          )}
        </div>
      </div>

      {/* Telemetry Masthead */}
      <section className="mb-6 rounded-md border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <div className="mb-1.5 flex flex-wrap items-center gap-2 font-mono-tabular text-xs">
              <span className="rounded bg-[var(--surface-recessed)] px-2 py-0.5 font-bold text-[var(--primary)]">
                #{run.run_code}
              </span>
              <span className="rounded border border-[var(--border)] px-2 py-0.5 text-[var(--text-muted)]">
                {run.environment_label}
              </span>
              <span
                className={`rounded px-2 py-0.5 font-bold uppercase ${
                  run.status === 'active'
                    ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                    : run.status === 'completed'
                      ? 'bg-[var(--success-bg)] text-[var(--success)]'
                      : run.status === 'aborted'
                        ? 'bg-[var(--danger-bg)] text-[var(--danger)]'
                        : 'bg-[var(--warning-bg)] text-[var(--warning)]'
                }`}
              >
                {run.status}
              </span>
            </div>
            <h1 className="text-2xl font-bold text-[var(--text)] sm:text-3xl">{run.title}</h1>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Initiated by {run.created_by_alias} at {formatTimeShort(run.started_at)}
            </p>
          </div>

          {/* Live Stopwatch + Lifecycle Actions */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded border border-[var(--border)] bg-[var(--bg)] px-4 py-2 text-right">
              <div className="font-mono-tabular text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                Active Elapsed
              </div>
              <div className="font-mono-tabular text-2xl font-bold text-[var(--text)]">
                {formatDuration(elapsedSec)}
              </div>
            </div>

            {canOperate && !runEnded && (
              <div className="flex flex-wrap gap-2">
                {run.status === 'active' ? (
                  <button
                    type="button"
                    onClick={() => handleLifecycle('pause')}
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--surface-recessed)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] hover:border-[var(--border-strong)]"
                  >
                    <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                    Pause
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleLifecycle('resume')}
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--on-primary)]"
                  >
                    <Play className="h-3.5 w-3.5" aria-hidden="true" />
                    Resume
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleLifecycle('complete')}
                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded bg-[var(--success)] px-3.5 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Finish Run
                </button>
                <button
                  type="button"
                  onClick={() => handleLifecycle('abort')}
                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded border border-[var(--danger)]/50 bg-[var(--danger-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--danger)] hover:opacity-90"
                >
                  <AlertOctagon className="h-3.5 w-3.5" aria-hidden="true" />
                  Abort
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Progress + Share & Export Strip */}
        <div className="mt-5 flex flex-col justify-between gap-3 border-t border-[var(--border)] pt-4 sm:flex-row sm:items-center">
          <div className="flex flex-1 items-center gap-3">
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-recessed)]">
              <div
                className="h-full bg-[var(--primary)] transition-all duration-300"
                style={{ width: `${stats.pct}%` }}
              />
            </div>
            <span className="font-mono-tabular text-xs font-semibold text-[var(--text)]">
              {stats.done}/{stats.total} ({stats.pct}%)
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canOperate && operatorKey && (
              <button
                type="button"
                onClick={() => copyShareLink('operator')}
                className="inline-flex items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--surface-recessed)] px-2.5 py-1.5 text-xs font-medium text-[var(--text)] hover:border-[var(--border-strong)]"
              >
                <Copy className="h-3.5 w-3.5 text-[var(--accent)]" aria-hidden="true" />
                {copiedType === 'operator' ? 'Copied Operator Link' : 'Share Operator Link'}
              </button>
            )}
            <button
              type="button"
              onClick={() => copyShareLink('viewer')}
              className="inline-flex items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--surface-recessed)] px-2.5 py-1.5 text-xs font-medium text-[var(--text)] hover:border-[var(--border-strong)]"
            >
              <Eye className="h-3.5 w-3.5 text-[var(--primary)]" aria-hidden="true" />
              {copiedType === 'viewer' ? 'Copied Observer Link' : 'Share Observer Link'}
            </button>
            <a
              href={`/api/runs/${encodeURIComponent(run.run_code)}/export?format=md`}
              className="inline-flex items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs font-medium text-[var(--text)] hover:border-[var(--primary)]"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              Audit .md
            </a>
            <a
              href={`/api/runs/${encodeURIComponent(run.run_code)}/export?format=json`}
              className="inline-flex items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs font-medium text-[var(--text)] hover:border-[var(--primary)]"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              .json
            </a>
          </div>
        </div>
      </section>

      {actionError && (
        <div className="mb-4 rounded border border-[var(--danger)] bg-[var(--danger-bg)] px-4 py-2.5 text-xs font-medium text-[var(--danger)]">
          {actionError}
        </div>
      )}

      {/* Observer Unlock Bar */}
      {!canOperate && !runEnded && (
        <section className="mb-6 flex flex-col justify-between gap-3 rounded-md border border-[var(--border-strong)] bg-[var(--surface-recessed)] p-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2.5 text-xs text-[var(--text)]">
            <ShieldAlert className="h-4 w-4 shrink-0 text-[var(--warning)]" aria-hidden="true" />
            <span>
              You are viewing this run in <strong>Read-Only Observer mode</strong>. Paste an Operator Key to execute cues or run Edge Probes.
            </span>
          </div>
          <form onSubmit={handleUnlockKey} className="flex items-center gap-2">
            <label htmlFor="unlock-key-input" className="sr-only">
              Operator Key
            </label>
            <input
              id="unlock-key-input"
              type="password"
              value={manualKeyInput}
              onChange={(e) => setManualKeyInput(e.target.value)}
              placeholder="Paste operator key..."
              className="w-48 rounded border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 font-mono-tabular text-xs text-[var(--text)]"
            />
            <button
              type="submit"
              className="rounded bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--on-primary)]"
            >
              Unlock
            </button>
          </form>
        </section>
      )}

      {/* Two-Pane Execution Console */}
      <div className="grid gap-6 lg:grid-cols-12">
        <section className="space-y-3 lg:col-span-8" aria-label="Cue Execution Pipeline">
          {steps.map((step) => (
            <CueStepRow
              key={step.id}
              step={step}
              probes={probeLogs.filter((p) => p.step_id === step.id)}
              canOperate={canOperate}
              runEnded={runEnded}
              nowMs={nowMs}
              busyStepId={busyStepId}
              onAction={handleStepAction}
              onRunProbe={handleRunProbe}
            />
          ))}
        </section>

        <aside className="space-y-5 lg:col-span-4">
          {/* Post-Run Summary Card */}
          {(runEnded || stats.done === stats.total) && (
            <section className="rounded-md border border-[var(--primary)] bg-[var(--surface)] p-4">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--primary)]">
                Post-Run Audit Snapshot
              </h2>
              <dl className="mt-3 space-y-2 text-xs">
                <div className="flex justify-between">
                  <dt className="text-[var(--text-muted)]">Completion</dt>
                  <dd className="font-mono-tabular font-bold text-[var(--text)]">
                    {stats.done}/{stats.total} passed ({stats.failed} failed)
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[var(--text-muted)]">Total Active Time</dt>
                  <dd className="font-mono-tabular font-bold text-[var(--text)]">
                    {formatDuration(elapsedSec)}
                  </dd>
                </div>
                {stats.avgLatency !== null && (
                  <div className="flex justify-between">
                    <dt className="text-[var(--text-muted)]">Avg Edge Probe Latency</dt>
                    <dd className="font-mono-tabular font-bold text-[var(--text)]">
                      {stats.avgLatency}ms ({probeLogs.length} probes)
                    </dd>
                  </div>
                )}
                {stats.slowest && (
                  <div className="border-t border-[var(--border)] pt-2">
                    <dt className="text-[var(--text-muted)]">Slowest Bottleneck Cue</dt>
                    <dd className="mt-0.5 font-medium text-[var(--text)]">
                      #{String(stats.slowest.position).padStart(2, '0')} {stats.slowest.title} (
                      <span className="font-mono-tabular">{stats.slowest.actual_seconds}s</span>)
                    </dd>
                  </div>
                )}
              </dl>
            </section>
          )}

          {/* Active Room Presence */}
          <section className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
            <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
              <Users className="h-3.5 w-3.5 text-[var(--primary)]" aria-hidden="true" />
              Active Room Presence ({onlinePeers.length || 1})
            </h2>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {(onlinePeers.length ? onlinePeers : [{ alias, role: canOperate ? 'operator' : 'observer' }]).map(
                (peer, i) => (
                  <span
                    key={`${peer.alias}-${i}`}
                    className="inline-flex items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs text-[var(--text)]"
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${
                        peer.role === 'operator' ? 'bg-[var(--accent)]' : 'bg-[var(--success)]'
                      }`}
                    />
                    {peer.alias}
                  </span>
                )
              )}
            </div>
          </section>

          {/* Live Chronological Timeline */}
          <section className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
              Chronological Event Log
            </h2>

            {canOperate && !runEnded && (
              <form onSubmit={handleAddNote} className="mt-3 flex gap-2">
                <label htmlFor="timeline-note" className="sr-only">
                  Add timeline event note
                </label>
                <input
                  id="timeline-note"
                  type="text"
                  maxLength={500}
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value)}
                  placeholder="Log field observation..."
                  className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-xs text-[var(--text)]"
                />
                <button
                  type="submit"
                  aria-label="Post timeline note"
                  className="inline-flex items-center justify-center rounded bg-[var(--primary)] px-2.5 py-1.5 text-xs font-semibold text-[var(--on-primary)]"
                >
                  <MessageSquarePlus className="h-3.5 w-3.5" />
                </button>
              </form>
            )}

            <ol className="mt-3 max-h-[460px] space-y-2.5 overflow-y-auto pr-1">
              {events.map((ev) => (
                <li
                  key={ev.id}
                  className="border-l-2 border-[var(--border-strong)] pl-3 text-xs"
                >
                  <div className="flex items-center justify-between gap-2 font-mono-tabular text-[10px] text-[var(--text-muted)]">
                    <span className="font-semibold text-[var(--primary)]">{ev.actor_alias}</span>
                    <span>{formatTimeShort(ev.created_at)}</span>
                  </div>
                  <p className="mt-0.5 text-[var(--text)]">{ev.message}</p>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </main>
  );
};
