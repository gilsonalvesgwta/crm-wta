import type { ReactNode } from 'react';

const tones = {
  neutral: 'bg-surface-2 text-muted border border-line',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
  info: 'bg-info-soft text-info',
} as const;

export function Badge({ tone = 'neutral', children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return <span className={`inline-flex h-6 items-center rounded-full px-2.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}
