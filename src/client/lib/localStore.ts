export interface SavedRunRef {
  runCode: string;
  title: string;
  environmentLabel: string;
  operatorKey?: string;
  startedAt: string;
}

const RECENT_RUNS_KEY = 'relayrun:recent_runs:v1';
const ALIAS_KEY = 'relayrun:operator_alias:v1';
const THEME_KEY = 'relayrun:theme:v1';

export function getStoredAlias(): string {
  try {
    return localStorage.getItem(ALIAS_KEY) || 'Lead Operator';
  } catch {
    return 'Lead Operator';
  }
}

export function setStoredAlias(alias: string): void {
  try {
    localStorage.setItem(ALIAS_KEY, alias.trim().slice(0, 40) || 'Lead Operator');
  } catch {
    // ignore storage failures
  }
}

export function getStoredTheme(): 'light' | 'dark' {
  try {
    const val = localStorage.getItem(THEME_KEY);
    if (val === 'dark' || val === 'light') return val;
  } catch {
    // ignore
  }
  return 'light';
}

export function setStoredTheme(theme: 'light' | 'dark'): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // ignore
  }
}

export function getRecentRuns(): SavedRunRef[] {
  try {
    const raw = localStorage.getItem(RECENT_RUNS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveRunRef(entry: SavedRunRef): void {
  try {
    const list = getRecentRuns().filter((r) => r.runCode !== entry.runCode);
    list.unshift(entry);
    localStorage.setItem(RECENT_RUNS_KEY, JSON.stringify(list.slice(0, 12)));
  } catch {
    // ignore
  }
}

export function getOperatorKeyForRun(runCode: string): string | null {
  const match = getRecentRuns().find((r) => r.runCode === runCode.toUpperCase());
  return match?.operatorKey ?? null;
}

export function saveOperatorKeyForRun(runCode: string, title: string, env: string, operatorKey: string): void {
  saveRunRef({
    runCode: runCode.toUpperCase(),
    title,
    environmentLabel: env,
    operatorKey,
    startedAt: new Date().toISOString()
  });
}
