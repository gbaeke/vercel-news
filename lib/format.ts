// Postgres timestamptz columns arrive as raw strings like
// "2026-07-24 11:49:31.100484+00" — microsecond precision and a bare "+00"
// offset, neither of which Date.parse accepts. Normalize to ISO first.
function parseTs(ts: string): Date | null {
  const iso = ts
    .trim()
    .replace(' ', 'T')
    .replace(/\.(\d{3})\d+/, '.$1')
    .replace(/([+-]\d{2})$/, '$1:00');
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

export function formatDate(ts: string | null): string {
  if (!ts) return '';
  const d = parseTs(ts);
  if (!d) return ts;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}

export function formatDateTime(ts: string | null): string {
  if (!ts) return '';
  const d = parseTs(ts);
  if (!d) return ts;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}
