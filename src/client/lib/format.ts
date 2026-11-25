export function formatDuration(totalSeconds: number): string {
  const sec = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatTimeShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--:--';
  return d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function computeElapsedMs(
  startedAt: string,
  endedAt: string | null,
  status: string,
  pausedAt: string | null,
  pausedAccumulatedMs: number,
  nowMs: number
): number {
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return 0;
  const endRef =
    endedAt ? new Date(endedAt).getTime() : status === 'paused' && pausedAt ? new Date(pausedAt).getTime() : nowMs;
  return Math.max(0, endRef - start - (pausedAccumulatedMs || 0));
}
