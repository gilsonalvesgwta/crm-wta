import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Spinner } from './spinner';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const styles: Record<Variant, string> = {
  primary: 'bg-primary text-primary-fg font-semibold hover:brightness-95',
  secondary: 'bg-surface text-ink border border-line hover:bg-surface-2 font-medium',
  ghost: 'bg-transparent text-muted hover:bg-surface-2 hover:text-ink font-medium',
  danger: 'bg-surface text-bad border border-line hover:bg-bad-soft font-medium',
};

export function Button({
  variant = 'primary', loading = false, size = 'md', className = '', children, disabled, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean; size?: 'md' | 'lg'; children: ReactNode }) {
  const h = size === 'lg' ? 'h-[46px] text-[15px] px-4' : 'h-10 text-sm px-3.5';
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-[6px] transition-[filter,background-color] duration-150 disabled:opacity-60 disabled:cursor-not-allowed ${h} ${styles[variant]} ${className}`}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}
