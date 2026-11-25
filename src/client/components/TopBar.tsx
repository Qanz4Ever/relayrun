import React, { useState } from 'react';
import { Activity, Moon, Sun, Terminal, UserCheck } from 'lucide-react';

interface TopBarProps {
  alias: string;
  onChangeAlias: (next: string) => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onNavigateHome: () => void;
  onJoinCode: (code: string) => void;
  edgeColo: string | null;
}

export const TopBar: React.FC<TopBarProps> = ({
  alias,
  onChangeAlias,
  theme,
  onToggleTheme,
  onNavigateHome,
  onJoinCode,
  edgeColo
}) => {
  const [editingAlias, setEditingAlias] = useState(false);
  const [aliasDraft, setAliasDraft] = useState(alias);
  const [codeInput, setCodeInput] = useState('');

  const handleAliasSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onChangeAlias(aliasDraft.trim() || 'Operator');
    setEditingAlias(false);
  };

  const handleCodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = codeInput.trim().toUpperCase();
    if (cleaned.length >= 6) {
      onJoinCode(cleaned);
      setCodeInput('');
    }
  };

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--surface)]/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onNavigateHome}
            className="group flex items-center gap-2.5 rounded px-1 py-0.5 text-left"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded bg-[var(--primary)] text-[var(--on-primary)]">
              <Terminal className="h-4 w-4" aria-hidden="true" />
            </span>
            <span>
              <span className="block font-[var(--font-display)] text-base font-bold tracking-tight text-[var(--text)]">
                RelayRun
              </span>
              <span className="block font-mono-tabular text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                Executable Cue Engine
              </span>
            </span>
          </button>

          {edgeColo && (
            <span
              className="hidden items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--surface-recessed)] px-2 py-0.5 font-mono-tabular text-[11px] text-[var(--text-muted)] sm:inline-flex"
              title="Serving Cloudflare Edge Location"
            >
              <Activity className="h-3 w-3 text-[var(--success)]" aria-hidden="true" />
              EDGE:{edgeColo}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <form onSubmit={handleCodeSubmit} className="flex items-center">
            <label htmlFor="jump-run-code" className="sr-only">
              Open run by code
            </label>
            <input
              id="jump-run-code"
              type="text"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
              placeholder="RUN CODE"
              maxLength={12}
              className="w-28 rounded-l border border-r-0 border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 font-mono-tabular text-xs uppercase text-[var(--text)] placeholder:text-[var(--text-muted)]"
            />
            <button
              type="submit"
              disabled={codeInput.trim().length < 6}
              className="rounded-r border border-[var(--border)] bg-[var(--surface-recessed)] px-2.5 py-1.5 text-xs font-medium text-[var(--text)] hover:bg-[var(--border)] disabled:opacity-45"
            >
              Open
            </button>
          </form>

          {editingAlias ? (
            <form onSubmit={handleAliasSubmit} className="flex items-center gap-1">
              <label htmlFor="operator-alias-input" className="sr-only">
                Operator callsign
              </label>
              <input
                id="operator-alias-input"
                type="text"
                value={aliasDraft}
                onChange={(e) => setAliasDraft(e.target.value)}
                maxLength={40}
                className="w-32 rounded border border-[var(--primary)] bg-[var(--bg)] px-2 py-1 text-xs text-[var(--text)]"
              />
              <button
                type="submit"
                className="rounded bg-[var(--primary)] px-2 py-1 text-xs font-medium text-[var(--on-primary)]"
              >
                Save
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => {
                setAliasDraft(alias);
                setEditingAlias(true);
              }}
              className="inline-flex min-h-[34px] items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--surface-recessed)] px-2.5 py-1 text-xs font-medium text-[var(--text)] hover:border-[var(--border-strong)]"
              title="Change your operator callsign"
            >
              <UserCheck className="h-3.5 w-3.5 text-[var(--primary)]" aria-hidden="true" />
              <span className="max-w-[120px] truncate">{alias}</span>
            </button>
          )}

          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light archival theme' : 'Switch to dark control room theme'}
            className="inline-flex min-h-[34px] min-w-[34px] items-center justify-center rounded border border-[var(--border)] bg-[var(--surface-recessed)] text-[var(--text)] hover:border-[var(--border-strong)]"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </header>
  );
};
