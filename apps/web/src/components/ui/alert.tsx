import type { ReactNode } from 'react';

const tones = {
  error: 'bg-bad-soft text-bad border-bad/30',
  warning: 'bg-warn-soft text-warn border-warn/30',
  success: 'bg-ok-soft text-ok border-ok/30',
  info: 'bg-info-soft text-info border-info/30',
} as const;

export function Alert({ tone = 'info', children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-[8px] border px-3.5 py-3 text-[13px] leading-relaxed ${tones[tone]}`}>
      {children}
    </div>
  );
}
