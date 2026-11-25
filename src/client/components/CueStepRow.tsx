import React, { useState } from 'react';
import {
  AlertTriangle,
  Check,
  Clock,
  Globe,
  GitBranch,
  Play,
  RotateCcw,
  SkipForward,
  UserPlus,
  XCircle
} from 'lucide-react';
import { ProbeLog, RunStep } from '../../shared/types';
import { formatDuration } from '../lib/format';

interface CueStepRowProps {
  step: RunStep;
  probes: ProbeLog[];
  canOperate: boolean;
  runEnded: boolean;
  nowMs: number;
  busyStepId: string | null;
  onAction: (stepId: string, action: 'claim' | 'start' | 'pass' | 'fail' | 'skip' | 'reopen' | 'note', note?: string) => void;
  onRunProbe: (stepId: string, overrideUrl?: string) => void;
}

export const CueStepRow: React.FC<CueStepRowProps> = ({
  step,
  probes,
  canOperate,
  runEnded,
  nowMs,
  busyStepId,
  onAction,
  onRunProbe
}) => {
  const [probeUrlDraft, setProbeUrlDraft] = useState(step.probe_url ?? '');
  const [noteDraft, setNoteDraft] = useState('');
  const [showNoteBox, setShowNoteBox] = useState(false);

  const isBusy = busyStepId === step.id;
  const latestProbe = probes[0];
  const cueNum = String(step.position).padStart(2, '0');

  const liveElapsedSec =
    step.actual_seconds !== null
      ? step.actual_seconds
      : step.started_at && step.status === 'in_progress'
        ? Math.max(0, Math.round((nowMs - new Date(step.started_at).getTime()) / 1000))
        : 0;

  const isOverBudget = liveElapsedSec > step.expected_seconds && step.status !== 'skipped';

  const statusStyles: Record<RunStep['status'], { rail: string; badge: string; label: string }> = {
    pending: {
      rail: 'border-l-[var(--border-strong)]',
      badge: 'bg-[var(--surface-recessed)] text-[var(--text-muted)]',
      label: 'QUEUED'
    },
    in_progress: {
      rail: 'border-l-[var(--accent)]',
      badge: 'bg-[var(--accent)] text-[var(--on-accent)]',
      label: 'LIVE CUE'
    },
    passed: {
      rail: 'border-l-[var(--success)]',
      badge: 'bg-[var(--success-bg)] text-[var(--success)]',
      label: 'VERIFIED'
    },
    failed: {
      rail: 'border-l-[var(--danger)]',
      badge: 'bg-[var(--danger-bg)] text-[var(--danger)]',
      label: 'BLOCKED / FAIL'
    },
    skipped: {
      rail: 'border-l-[var(--warning)]',
      badge: 'bg-[var(--warning-bg)] text-[var(--warning)]',
      label: 'SKIPPED'
    }
  };

  const style = statusStyles[step.status];

  return (
    <article
      className={`rounded-md border border-[var(--border)] border-l-4 ${style.rail} bg-[var(--surface)] transition-colors`}
    >
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
        {/* Serialized Cue Rail */}
        <div className="flex shrink-0 items-center gap-3 sm:w-20 sm:flex-col sm:items-start sm:gap-1">
          <span className="font-mono-tabular text-2xl font-bold leading-none text-[var(--text)]">
            {cueNum}
          </span>
          <span className={`rounded px-1.5 py-0.5 font-mono-tabular text-[10px] font-bold tracking-wider ${style.badge}`}>
            {style.label}
          </span>
        </div>

        {/* Main Cue Content */}
        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-bold text-[var(--text)]">{step.title}</h3>
                {step.step_type === 'http_probe' && (
                  <span className="inline-flex items-center gap-1 rounded border border-[var(--primary)]/30 bg-[var(--primary)]/10 px-1.5 py-0.5 font-mono-tabular text-[10px] font-semibold uppercase text-[var(--primary)]">
                    <Globe className="h-3 w-3" aria-hidden="true" />
                    Edge Probe
                  </span>
                )}
                {step.step_type === 'decision' && (
                  <span className="inline-flex items-center gap-1 rounded border border-[var(--warning)]/40 bg-[var(--warning-bg)] px-1.5 py-0.5 font-mono-tabular text-[10px] font-semibold uppercase text-[var(--warning)]">
                    <GitBranch className="h-3 w-3" aria-hidden="true" />
                    Decision Gate
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]">
                <span>
                  Role: <strong className="font-medium text-[var(--text)]">{step.owner_role}</strong>
                </span>
                <span>
                  Claimed:{' '}
                  <strong className="font-medium text-[var(--text)]">
                    {step.claimed_by ?? 'Unassigned'}
                  </strong>
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--surface-recessed)] px-2.5 py-1 font-mono-tabular text-xs">
              <Clock
                className={`h-3.5 w-3.5 ${isOverBudget ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]'}`}
                aria-hidden="true"
              />
              <span className={isOverBudget ? 'font-bold text-[var(--danger)]' : 'text-[var(--text)]'}>
                {formatDuration(liveElapsedSec)}
              </span>
              <span className="text-[var(--text-muted)]">/ {formatDuration(step.expected_seconds)}</span>
            </div>
          </div>

          {step.instructions && (
            <p className="text-sm leading-relaxed text-[var(--text-muted)]">{step.instructions}</p>
          )}

          {/* Edge Probe Inspector Panel */}
          {step.step_type === 'http_probe' && (
            <div className="rounded border border-[var(--border)] bg-[var(--bg)] p-3 space-y-2.5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <span className="shrink-0 rounded bg-[var(--surface-recessed)] px-2 py-1 font-mono-tabular text-xs font-bold text-[var(--primary)]">
                  {step.probe_method ?? 'GET'}
                </span>
                <label htmlFor={`probe-url-${step.id}`} className="sr-only">
                  Probe target URL
                </label>
                <input
                  id={`probe-url-${step.id}`}
                  type="url"
                  value={probeUrlDraft}
                  disabled={!canOperate || runEnded}
                  onChange={(e) => setProbeUrlDraft(e.target.value)}
                  className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 font-mono-tabular text-xs text-[var(--text)] disabled:opacity-70"
                />
                {canOperate && !runEnded && (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => onRunProbe(step.id, probeUrlDraft)}
                    className="inline-flex min-h-[34px] shrink-0 items-center justify-center gap-1.5 rounded bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--on-primary)] hover:bg-[var(--primary-hover)] disabled:opacity-50"
                  >
                    <Globe className="h-3.5 w-3.5" aria-hidden="true" />
                    {isBusy ? 'Probing Edge...' : 'Run Edge Probe'}
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 font-mono-tabular text-[11px] text-[var(--text-muted)]">
                <span>Expect HTTP {step.probe_expected_status ?? 200}</span>
                {step.probe_match_text && <span>· Body contains {step.probe_match_text}</span>}
              </div>

              {latestProbe && (
                <div
                  className={`rounded border p-2.5 font-mono-tabular text-xs ${
                    latestProbe.matched
                      ? 'border-[var(--success)]/40 bg-[var(--success-bg)] text-[var(--success)]'
                      : 'border-[var(--danger)]/40 bg-[var(--danger-bg)] text-[var(--danger)]'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 font-bold">
                    <span>
                      [{latestProbe.edge_colo ?? 'EDGE'}] HTTP {latestProbe.status_code ?? 'ERR'} ·{' '}
                      {latestProbe.latency_ms}ms · {latestProbe.matched ? 'PASS' : 'FAIL'}
                    </span>
                    <span className="text-[11px] font-normal opacity-80">
                      {new Date(latestProbe.created_at).toLocaleTimeString([], { hour12: false })}
                    </span>
                  </div>
                  {latestProbe.error_message && (
                    <div className="mt-1 text-[11px]">{latestProbe.error_message}</div>
                  )}
                  {latestProbe.response_snippet && (
                    <pre className="mt-1.5 max-h-20 overflow-x-auto whitespace-pre-wrap break-all rounded bg-black/10 p-1.5 text-[11px] text-[var(--text)]">
                      {latestProbe.response_snippet}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Rollback / Mitigation Callout */}
          {(step.status === 'failed' || step.step_type === 'decision') && step.rollback_note && (
            <div className="flex items-start gap-2 rounded border border-[var(--warning)]/40 bg-[var(--warning-bg)] px-3 py-2 text-xs text-[var(--text)]">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--warning)]" aria-hidden="true" />
              <div>
                <span className="font-semibold uppercase tracking-wider text-[var(--warning)]">
                  Mitigation / Rollback:{' '}
                </span>
                <span>{step.rollback_note}</span>
              </div>
            </div>
          )}

          {step.operator_note && (
            <div className="rounded border border-[var(--border)] bg-[var(--surface-recessed)] px-3 py-1.5 text-xs text-[var(--text)]">
              <span className="font-semibold text-[var(--text-muted)]">Note: </span>
              {step.operator_note}
            </div>
          )}

          {/* Controls */}
          {canOperate && !runEnded && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                disabled={isBusy}
                onClick={() => onAction(step.id, 'claim')}
                className="inline-flex min-h-[34px] items-center gap-1 rounded border border-[var(--border)] bg-[var(--surface-recessed)] px-2.5 py-1 text-xs font-medium text-[var(--text)] hover:border-[var(--border-strong)] disabled:opacity-50"
              >
                <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                Claim
              </button>

              {step.status === 'pending' && (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => onAction(step.id, 'start')}
                  className="inline-flex min-h-[34px] items-center gap-1 rounded bg-[var(--primary)] px-2.5 py-1 text-xs font-semibold text-[var(--on-primary)] hover:bg-[var(--primary-hover)] disabled:opacity-50"
                >
                  <Play className="h-3.5 w-3.5" aria-hidden="true" />
                  Start Cue
                </button>
              )}

              {(step.status === 'pending' || step.status === 'in_progress') && (
                <>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => onAction(step.id, 'pass')}
                    className="inline-flex min-h-[34px] items-center gap-1 rounded bg-[var(--success)] px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                  >
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    Verify Pass
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => onAction(step.id, 'fail')}
                    className="inline-flex min-h-[34px] items-center gap-1 rounded border border-[var(--danger)]/50 bg-[var(--danger-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--danger)] hover:opacity-90 disabled:opacity-50"
                  >
                    <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                    Flag Fail
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => onAction(step.id, 'skip')}
                    className="inline-flex min-h-[34px] items-center gap-1 rounded border border-[var(--border)] px-2.5 py-1 text-xs font-medium text-[var(--text-muted)] hover:bg-[var(--surface-recessed)] disabled:opacity-50"
                  >
                    <SkipForward className="h-3.5 w-3.5" aria-hidden="true" />
                    Skip
                  </button>
                </>
              )}

              {(step.status === 'passed' || step.status === 'failed' || step.status === 'skipped') && (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => onAction(step.id, 'reopen')}
                  className="inline-flex min-h-[34px] items-center gap-1 rounded border border-[var(--border)] bg-[var(--surface-recessed)] px-2.5 py-1 text-xs font-medium text-[var(--text)] hover:border-[var(--border-strong)] disabled:opacity-50"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  Reopen
                </button>
              )}

              <button
                type="button"
                onClick={() => setShowNoteBox((v) => !v)}
                className="ml-auto text-xs font-medium text-[var(--text-muted)] underline-offset-2 hover:text-[var(--text)] hover:underline"
              >
                {showNoteBox ? 'Close note' : '+ Add note'}
              </button>
            </div>
          )}

          {showNoteBox && canOperate && !runEnded && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!noteDraft.trim()) return;
                onAction(step.id, 'note', noteDraft.trim());
                setNoteDraft('');
                setShowNoteBox(false);
              }}
              className="flex gap-2 pt-1"
            >
              <input
                type="text"
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                maxLength={500}
                placeholder="Attach execution note to this cue..."
                className="flex-1 rounded border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-xs text-[var(--text)]"
              />
              <button
                type="submit"
                className="rounded bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--on-primary)]"
              >
                Save Note
              </button>
            </form>
          )}
        </div>
      </div>
    </article>
  );
};
