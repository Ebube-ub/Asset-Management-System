import { formatDistanceToNow, format } from 'date-fns';

export function relativeTime(value?: string | null): string {
  if (!value) return '—';
  try {
    return formatDistanceToNow(new Date(value), { addSuffix: true });
  } catch {
    return '—';
  }
}

export function shortDate(value?: string | null): string {
  if (!value) return '—';
  try {
    return format(new Date(value), 'd MMM yyyy');
  } catch {
    return '—';
  }
}

export function dateTime(value?: string | null): string {
  if (!value) return '—';
  try {
    return format(new Date(value), 'd MMM yyyy, HH:mm');
  } catch {
    return '—';
  }
}

export function initials(name?: string | null): string {
  if (!name) return '?';
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}

export function naira(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return '₦' + n.toLocaleString('en-NG', { maximumFractionDigits: 0 });
}

export function compactNumber(value: number): string {
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (value >= 1_000) return (value / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(value);
}

export function humanise(value?: string | null): string {
  if (!value) return '—';
  return value.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}
