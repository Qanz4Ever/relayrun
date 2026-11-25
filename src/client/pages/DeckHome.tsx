import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  Clock,
  CopyPlus,
  Globe,
  Layers,
  Play,
  Plus,
  Radio,
  ShieldCheck
} from 'lucide-react';
import { Blueprint, BlueprintCategory } from '../../shared/types';
import { formatDuration } from '../lib/format';
import { SavedRunRef } from '../lib/localStore';

interface DeckHomeProps {
  blueprints: Blueprint[];
  loading: boolean;
  error: string | null;
  recentRuns: SavedRunRef[];
  onLaunchBlueprint: (bp: Blueprint, envLabel: string) => Promise<void>;
  onOpenBuilder: (forkFrom?: Blueprint | null) => void;
  onOpenRun: (runCode: string) => void;
  edgeColo: string | null;
}

const CATEGORIES: Array<{ id: 'all' | BlueprintCategory; label: string }> = [
  { id: 'all', label: 'All Decks' },
  { id: 'release', label: 'Release' },
  { id: 'incident', label: 'Incident' },
  { id: 'broadcast', label: 'Broadcast' },
  { id: 'migration', label: 'Migration' },
  { id: 'custom', label: 'Custom' }
];

export const DeckHome: React.FC<DeckHomeProps> = ({
  blueprints,
  loading,
  error,
  recentRuns,
  onLaunchBlueprint,
  onOpenBuilder,
  onOpenRun,
  edgeColo
}) => {
  const [selectedCategory, setSelectedCategory] = useState<'all' | BlueprintCategory>('all');
  const [envLabel, setEnvLabel] = useState('Production');
  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (selectedCategory === 'all') return blueprints;
    return blueprints.filter((bp) => bp.category === selectedCategory);
  }, [blueprints, selectedCategory]);

  const handleLaunch = async (bp: Blueprint) => {
    setLaunchError(null);
    setLaunchingId(bp.id);
    try {
      await onLaunchBlueprint(bp, envLabel.trim() || 'Production');
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : 'Failed to launch run');
      setLaunchingId(null);
    }
  };

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      {/* Compact Command Masthead */}
      <section className="mb-8 border-b border-[var(--border)] pb-6">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div className="max-w-2xl">
            <div className="mb-2 inline-flex items-center gap-2 font-mono-tabular text-xs font-semibold uppercase tracking-widest text-[var(--accent)]">
              <Radio className="h-3.5 w-3.5" aria-hidden="true" />
              Live Operational Cue Sheets
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-[var(--text)] sm:text-4xl">
              Execute critical runbooks with live edge probes and shared timelines.
            </h1>
            <p className="mt-2.5 max-w-[65ch] text-sm text-[var(--text-muted)] sm:text-base">
              Pick a blueprint or build your own, launch a multiplayer execution room in one click, verify endpoints from Cloudflare Edge, and export a timestamped postmortem report.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div>
              <label htmlFor="target-env-input" className="mb-1 block font-mono-tabular text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Target Environment
              </label>
              <input
                id="target-env-input"
                type="text"
                maxLength={40}
                value={envLabel}
                onChange={(e) => setEnvLabel(e.target.value)}
                className="w-36 rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-medium text-[var(--text)]"
              />
            </div>
            <div className="pt-4">
              <button
                type="button"
                onClick={() => onOpenBuilder(null)}
                className="inline-flex min-h-[40px] items-center gap-2 rounded bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--on-primary)] hover:bg-[var(--primary-hover)]"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                New Blueprint
              </button>
            </div>
          </div>
        </div>
      </section>

      {launchError && (
        <div className="mb-6 rounded border border-[var(--danger)] bg-[var(--danger-bg)] px-4 py-3 text-sm text-[var(--danger)]">
          {launchError}
        </div>
      )}

      {/* Asymmetric Split Layout: Blueprints Deck (Left) + Local Runs & Edge Spec (Right) */}
      <div className="grid gap-8 lg:grid-cols-12">
        <section className="space-y-4 lg:col-span-8" aria-label="Runbook Blueprints">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-[var(--text)]">Executable Blueprints</h2>
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter blueprints by category">
              {CATEGORIES.map((cat) => {
                const active = selectedCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setSelectedCategory(cat.id)}
                    className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                      active
                        ? 'bg-[var(--text)] text-[var(--surface)]'
                        : 'border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)]'
                    }`}
                  >
                    {cat.label}
                  </button>
                );
              })}
            </div>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((n) => (
                <div
                  key={n}
                  className="h-40 animate-pulse rounded-md border border-[var(--border)] bg-[var(--surface)]"
                />
              ))}
            </div>
          ) : error ? (
            <div className="rounded-md border border-[var(--danger)] bg-[var(--danger-bg)] p-4 text-sm text-[var(--danger)]">
              {error}
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-md border border-dashed border-[var(--border-strong)] bg-[var(--surface)] p-8 text-center">
              <p className="text-sm font-medium text-[var(--text)]">
                No blueprints in this category yet.
              </p>
              <button
                type="button"
                onClick={() => onOpenBuilder(null)}
                className="mt-3 inline-flex items-center gap-1.5 rounded bg-[var(--primary)] px-3.5 py-2 text-xs font-semibold text-[var(--on-primary)]"
              >
                <Plus className="h-3.5 w-3.5" />
                Create Custom Blueprint
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {filtered.map((bp) => {
                const steps = bp.steps ?? [];
                const totalTargetSec = steps.reduce((acc, s) => acc + s.expected_seconds, 0);
                const probeCount = steps.filter((s) => s.step_type === 'http_probe').length;

                return (
                  <article
                    key={bp.id}
                    className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-5"
                  >
                    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                      <div className="min-w-0 flex-1">
                        <div className="mb-1.5 flex flex-wrap items-center gap-2">
                          <span className="rounded border border-[var(--border)] bg-[var(--surface-recessed)] px-2 py-0.5 font-mono-tabular text-[10px] font-bold uppercase tracking-wider text-[var(--primary)]">
                            {bp.category}
                          </span>
                          <span className="font-mono-tabular text-xs text-[var(--text-muted)]">
                            {steps.length} cues · {formatDuration(totalTargetSec)} est
                          </span>
                          {probeCount > 0 && (
                            <span className="inline-flex items-center gap-1 font-mono-tabular text-xs text-[var(--primary)]">
                              <Globe className="h-3 w-3" aria-hidden="true" />
                              {probeCount} edge {probeCount === 1 ? 'probe' : 'probes'}
                            </span>
                          )}
                          <span className="font-mono-tabular text-xs text-[var(--text-muted)]">
                            · {bp.run_count} runs
                          </span>
                        </div>
                        <h3 className="text-xl font-bold text-[var(--text)]">{bp.title}</h3>
                        {bp.summary && (
                          <p className="mt-1 text-sm text-[var(--text-muted)]">{bp.summary}</p>
                        )}
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onOpenBuilder(bp)}
                          className="inline-flex min-h-[38px] items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--surface-recessed)] px-3 py-1.5 text-xs font-medium text-[var(--text)] hover:border-[var(--border-strong)]"
                          title="Fork and customize steps"
                        >
                          <CopyPlus className="h-3.5 w-3.5" aria-hidden="true" />
                          Fork
                        </button>
                        <button
                          type="button"
                          disabled={launchingId === bp.id}
                          onClick={() => handleLaunch(bp)}
                          className="inline-flex min-h-[38px] items-center gap-1.5 rounded bg-[var(--accent)] px-4 py-1.5 text-xs font-semibold text-[var(--on-accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50"
                        >
                          <Play className="h-3.5 w-3.5" aria-hidden="true" />
                          {launchingId === bp.id ? 'Launching...' : 'Launch Live Run'}
                        </button>
                      </div>
                    </div>

                    {/* Preview Cue Strip Rail */}
                    {steps.length > 0 && (
                      <ol className="mt-4 grid gap-2 border-t border-[var(--border)] pt-3.5 sm:grid-cols-2">
                        {steps.slice(0, 6).map((st) => (
                          <li
                            key={st.id}
                            className="flex items-center gap-2.5 rounded bg-[var(--bg)] px-2.5 py-1.5 text-xs"
                          >
                            <span className="font-mono-tabular font-bold text-[var(--text-muted)]">
                              {String(st.position).padStart(2, '0')}
                            </span>
                            <span className="min-w-0 flex-1 truncate font-medium text-[var(--text)]">
                              {st.title}
                            </span>
                            {st.step_type === 'http_probe' && (
                              <Globe className="h-3.5 w-3.5 shrink-0 text-[var(--primary)]" aria-label="HTTP Edge Probe" />
                            )}
                          </li>
                        ))}
                      </ol>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* Right Utility Rail */}
        <aside className="space-y-6 lg:col-span-4">
          <section className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-[var(--text)]">
                <Clock className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                Recent Local Runs
              </h2>
              <span className="font-mono-tabular text-xs text-[var(--text-muted)]">
                {recentRuns.length} saved
              </span>
            </div>

            {recentRuns.length === 0 ? (
              <p className="rounded border border-dashed border-[var(--border)] bg-[var(--bg)] p-3.5 text-xs text-[var(--text-muted)]">
                Launch any blueprint on the left. Your operator key and run code are saved locally so you can return anytime.
              </p>
            ) : (
              <ul className="space-y-2">
                {recentRuns.map((item) => (
                  <li key={item.runCode}>
                    <button
                      type="button"
                      onClick={() => onOpenRun(item.runCode)}
                      className="flex w-full items-center justify-between gap-2 rounded border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-left hover:border-[var(--primary)]"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono-tabular text-xs font-bold text-[var(--primary)]">
                            {item.runCode}
                          </span>
                          <span className="rounded bg-[var(--surface-recessed)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-muted)]">
                            {item.environmentLabel}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-xs font-medium text-[var(--text)]">
                          {item.title}
                        </p>
                      </div>
                      <ArrowRight className="h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-md border border-[var(--border)] bg-[var(--surface-recessed)] p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-[var(--text)]">
              <ShieldCheck className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
              Infrastructure Contract
            </h2>
            <dl className="space-y-2.5 text-xs">
              <div className="flex items-start justify-between gap-2 border-b border-[var(--border)] pb-2">
                <dt className="text-[var(--text-muted)]">Edge Runtime</dt>
                <dd className="font-mono-tabular font-medium text-[var(--text)]">
                  Cloudflare Worker {edgeColo ? `(${edgeColo})` : ''}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-2 border-b border-[var(--border)] pb-2">
                <dt className="text-[var(--text-muted)]">Persistence & Sync</dt>
                <dd className="font-mono-tabular font-medium text-[var(--text)]">
                  Supabase Postgres + Realtime
                </dd>
              </div>
              <div className="flex items-start justify-between gap-2 border-b border-[var(--border)] pb-2">
                <dt className="text-[var(--text-muted)]">Write Isolation</dt>
                <dd className="font-mono-tabular font-medium text-[var(--text)]">
                  RLS + Capability SHA-256
                </dd>
              </div>
              <div className="flex items-start justify-between gap-2">
                <dt className="text-[var(--text-muted)]">Edge Probe Guard</dt>
                <dd className="font-mono-tabular font-medium text-[var(--text)]">
                  Anti-SSRF + KV Rate Limit
                </dd>
              </div>
            </dl>
            <div className="mt-3 flex items-center gap-2 rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[11px] text-[var(--text-muted)]">
              <Layers className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" aria-hidden="true" />
              <span>Share Observer links safely: viewers get live telemetry without write access.</span>
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
};
