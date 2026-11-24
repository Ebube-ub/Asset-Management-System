const TONES: Record<string, { soft: string; solid: string }> = {
  blue: { soft: 'bg-brand-50 text-brand-600', solid: 'bg-brand-500 text-white' },
  green: { soft: 'bg-emerald-50 text-emerald-600', solid: 'bg-emerald-600 text-white' },
  emerald: { soft: 'bg-emerald-50 text-emerald-600', solid: 'bg-emerald-600 text-white' },
  amber: { soft: 'bg-amber-50 text-amber-600', solid: 'bg-amber-500 text-white' },
  red: { soft: 'bg-red-50 text-red-600', solid: 'bg-red-500 text-white' },
  violet: { soft: 'bg-violet-50 text-violet-600', solid: 'bg-violet-500 text-white' },
  purple: { soft: 'bg-violet-50 text-violet-600', solid: 'bg-violet-500 text-white' },
  slate: { soft: 'bg-slate-100 text-slate-600', solid: 'bg-slate-600 text-white' },
};

/** Tailwind classes for a tone, used for icon tiles and tinted panels. */
export function bg(tone: string, variant: 'soft' | 'solid' | 'panel' = 'soft'): string {
  const t = TONES[tone] ?? TONES.slate;
  if (variant === 'solid') return t.solid;
  if (variant === 'panel') return `${t.soft.replace('text-', 'border-').split(' ')[0]} border ${t.soft}`;
  return t.soft;
}
