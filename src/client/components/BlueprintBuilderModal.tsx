import React, { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2, X } from 'lucide-react';
import { Blueprint, BlueprintCategory, BlueprintStepInput, StepType } from '../../shared/types';

interface BlueprintBuilderModalProps {
  initialBlueprint?: Blueprint | null;
  onClose: () => void;
  onSave: (payload: {
    title: string;
    summary: string;
    category: BlueprintCategory;
    forked_from_id?: string | null;
    steps: BlueprintStepInput[];
  }) => Promise<void>;
}

function emptyStep(): BlueprintStepInput {
  return {
    title: '',
    step_type: 'manual',
    owner_role: 'Operator',
    expected_seconds: 120,
    instructions: '',
    probe_url: '',
    probe_method: 'GET',
    probe_expected_status: 200,
    probe_match_text: '',
    rollback_note: ''
  };
}

export const BlueprintBuilderModal: React.FC<BlueprintBuilderModalProps> = ({
  initialBlueprint,
  onClose,
  onSave
}) => {
  const [title, setTitle] = useState(
    initialBlueprint ? `${initialBlueprint.title} (Fork)` : ''
  );
  const [summary, setSummary] = useState(initialBlueprint?.summary ?? '');
  const [category, setCategory] = useState<BlueprintCategory>(
    initialBlueprint?.category ?? 'release'
  );
  const [steps, setSteps] = useState<BlueprintStepInput[]>(() => {
    if (initialBlueprint?.steps?.length) {
      return initialBlueprint.steps.map((s) => ({
        title: s.title,
        step_type: s.step_type,
        owner_role: s.owner_role,
        expected_seconds: s.expected_seconds,
        instructions: s.instructions,
        probe_url: s.probe_url ?? '',
        probe_method: s.probe_method ?? 'GET',
        probe_expected_status: s.probe_expected_status ?? 200,
        probe_match_text: s.probe_match_text ?? '',
        rollback_note: s.rollback_note
      }));
    }
    return [
      {
        title: 'Pre-flight sanity check',
        step_type: 'manual',
        owner_role: 'Lead',
        expected_seconds: 90,
        instructions: 'Confirm scope and rollback readiness before executing changes.',
        rollback_note: 'Pause window and notify team.'
      },
      {
        title: 'Edge HTTP Probe verification',
        step_type: 'http_probe',
        owner_role: 'SRE',
        expected_seconds: 45,
        instructions: 'Verify target endpoint responds 200 OK from Cloudflare Edge.',
        probe_url: `${window.location.origin}/api/demo-health`,
        probe_method: 'GET',
        probe_expected_status: 200,
        probe_match_text: '"status":"ok"',
        rollback_note: 'Revert traffic route to previous healthy deployment.'
      }
    ];
  });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateStep = (index: number, patch: Partial<BlueprintStepInput>) => {
    setSteps((prev) => prev.map((item, idx) => (idx === index ? { ...item, ...patch } : item)));
  };

  const moveStep = (index: number, dir: -1 | 1) => {
    const nextIdx = index + dir;
    if (nextIdx < 0 || nextIdx >= steps.length) return;
    setSteps((prev) => {
      const copy = [...prev];
      const [moved] = copy.splice(index, 1);
      copy.splice(nextIdx, 0, moved);
      return copy;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onSave({
        title,
        summary,
        category,
        forked_from_id: initialBlueprint?.id ?? null,
        steps
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save blueprint');
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="builder-modal-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-md border border-[var(--border-strong)] bg-[var(--surface)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface-recessed)] px-5 py-3.5">
          <div>
            <h2 id="builder-modal-title" className="text-lg font-bold text-[var(--text)]">
              {initialBlueprint ? 'Fork & Customize Blueprint' : 'New Executable Runbook Blueprint'}
            </h2>
            <p className="text-xs text-[var(--text-muted)]">
              Saved publicly as a reusable cue sheet with shareable URL.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close blueprint builder"
            className="rounded p-1.5 text-[var(--text-muted)] hover:bg-[var(--border)] hover:text-[var(--text)]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 space-y-5 overflow-y-auto p-5">
          {error && (
            <div className="rounded border border-[var(--danger)] bg-[var(--danger-bg)] px-3.5 py-2.5 text-xs font-medium text-[var(--danger)]">
              {error}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label htmlFor="bp-title" className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Blueprint Title
              </label>
              <input
                id="bp-title"
                type="text"
                required
                minLength={3}
                maxLength={120}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Database Failover & DNS Cutover"
                className="w-full rounded border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)]"
              />
            </div>
            <div>
              <label htmlFor="bp-category" className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Category
              </label>
              <select
                id="bp-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as BlueprintCategory)}
                className="w-full rounded border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)]"
              >
                <option value="release">Release</option>
                <option value="incident">Incident</option>
                <option value="broadcast">Broadcast</option>
                <option value="migration">Migration</option>
                <option value="custom">Custom</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="bp-summary" className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Operational Summary
            </label>
            <input
              id="bp-summary"
              type="text"
              maxLength={400}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="When to use this runbook and expected exit criteria"
              className="w-full rounded border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)]"
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Cue Sequence ({steps.length}/25)
              </h3>
              <button
                type="button"
                disabled={steps.length >= 25}
                onClick={() => setSteps((prev) => [...prev, emptyStep()])}
                className="inline-flex items-center gap-1 rounded border border-[var(--border-strong)] bg-[var(--surface-recessed)] px-2.5 py-1 text-xs font-medium text-[var(--text)] hover:bg-[var(--border)] disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Add Cue
              </button>
            </div>

            {steps.map((step, idx) => (
              <div
                key={`step-draft-${idx}`}
                className="rounded border border-[var(--border)] bg-[var(--bg)] p-3.5"
              >
                <div className="mb-2.5 flex items-center justify-between gap-2">
                  <span className="font-mono-tabular text-xs font-bold text-[var(--primary)]">
                    CUE #{String(idx + 1).padStart(2, '0')}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => moveStep(idx, -1)}
                      disabled={idx === 0}
                      aria-label={`Move cue ${idx + 1} up`}
                      className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--surface-recessed)] disabled:opacity-30"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveStep(idx, 1)}
                      disabled={idx === steps.length - 1}
                      aria-label={`Move cue ${idx + 1} down`}
                      className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--surface-recessed)] disabled:opacity-30"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setSteps((prev) => prev.filter((_, i) => i !== idx))}
                      disabled={steps.length <= 1}
                      aria-label={`Remove cue ${idx + 1}`}
                      className="rounded p-1 text-[var(--danger)] hover:bg-[var(--danger-bg)] disabled:opacity-30"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div className="grid gap-2.5 sm:grid-cols-4">
                  <div className="sm:col-span-2">
                    <input
                      type="text"
                      required
                      minLength={2}
                      maxLength={140}
                      value={step.title}
                      onChange={(e) => updateStep(idx, { title: e.target.value })}
                      placeholder="Cue action title"
                      className="w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm text-[var(--text)]"
                    />
                  </div>
                  <div>
                    <select
                      value={step.step_type}
                      onChange={(e) => updateStep(idx, { step_type: e.target.value as StepType })}
                      className="w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--text)]"
                    >
                      <option value="manual">Manual Action</option>
                      <option value="http_probe">Edge HTTP Probe</option>
                      <option value="decision">Decision Gate</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      maxLength={40}
                      value={step.owner_role}
                      onChange={(e) => updateStep(idx, { owner_role: e.target.value })}
                      placeholder="Role"
                      className="w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs text-[var(--text)]"
                    />
                    <input
                      type="number"
                      min={10}
                      max={86400}
                      value={step.expected_seconds}
                      onChange={(e) => updateStep(idx, { expected_seconds: Number(e.target.value) || 60 })}
                      title="Target seconds"
                      className="w-16 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 font-mono-tabular text-xs text-[var(--text)]"
                    />
                  </div>
                </div>

                {step.step_type === 'http_probe' && (
                  <div className="mt-2.5 grid gap-2 rounded border border-[var(--border)] bg-[var(--surface-recessed)] p-2.5 sm:grid-cols-6">
                    <div className="sm:col-span-3">
                      <label className="mb-0.5 block text-[10px] font-semibold uppercase text-[var(--text-muted)]">
                        Public Probe URL
                      </label>
                      <input
                        type="url"
                        required
                        value={step.probe_url ?? ''}
                        onChange={(e) => updateStep(idx, { probe_url: e.target.value })}
                        placeholder="https://example.com/health"
                        className="w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 font-mono-tabular text-xs text-[var(--text)]"
                      />
                    </div>
                    <div>
                      <label className="mb-0.5 block text-[10px] font-semibold uppercase text-[var(--text-muted)]">
                        Method
                      </label>
                      <select
                        value={step.probe_method ?? 'GET'}
                        onChange={(e) => updateStep(idx, { probe_method: e.target.value as 'GET' | 'HEAD' })}
                        className="w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 font-mono-tabular text-xs text-[var(--text)]"
                      >
                        <option value="GET">GET</option>
                        <option value="HEAD">HEAD</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-0.5 block text-[10px] font-semibold uppercase text-[var(--text-muted)]">
                        Expect HTTP
                      </label>
                      <input
                        type="number"
                        min={100}
                        max={599}
                        value={step.probe_expected_status ?? 200}
                        onChange={(e) => updateStep(idx, { probe_expected_status: Number(e.target.value) || 200 })}
                        className="w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 font-mono-tabular text-xs text-[var(--text)]"
                      />
                    </div>
                    <div>
                      <label className="mb-0.5 block text-[10px] font-semibold uppercase text-[var(--text-muted)]">
                        Body Match
                      </label>
                      <input
                        type="text"
                        maxLength={120}
                        value={step.probe_match_text ?? ''}
                        onChange={(e) => updateStep(idx, { probe_match_text: e.target.value })}
                        placeholder="optional"
                        className="w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 font-mono-tabular text-xs text-[var(--text)]"
                      />
                    </div>
                  </div>
                )}

                <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                  <input
                    type="text"
                    maxLength={1500}
                    value={step.instructions}
                    onChange={(e) => updateStep(idx, { instructions: e.target.value })}
                    placeholder="Instructions / verification commands"
                    className="w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs text-[var(--text)]"
                  />
                  <input
                    type="text"
                    maxLength={600}
                    value={step.rollback_note}
                    onChange={(e) => updateStep(idx, { rollback_note: e.target.value })}
                    placeholder="Rollback / fallback plan if blocked"
                    className="w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs text-[var(--text)]"
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-end gap-2.5 border-t border-[var(--border)] pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-[var(--border)] bg-[var(--surface-recessed)] px-4 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--border)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--on-accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50"
            >
              {submitting ? 'Saving Blueprint...' : 'Save Blueprint'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
