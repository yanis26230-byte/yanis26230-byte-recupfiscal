import * as React from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-2xl border border-line bg-white p-5 shadow-sm sm:p-6', className)} {...props} />;
}
export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-lg font-semibold text-navy', className)} {...props} />;
}
export function Badge({ className, tone = 'neutral', ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: 'neutral' | 'good' | 'warn' | 'info' | 'danger' }) {
  const tones = { neutral: 'bg-surface text-navy', good: 'bg-green-50 text-money', warn: 'bg-amber-50 text-amber-800', info: 'bg-blue-50 text-brand-dark', danger: 'bg-red-50 text-danger' };
  return <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', tones[tone], className)} {...props} />;
}
export function Alert({ className, tone = 'info', ...props }: React.HTMLAttributes<HTMLDivElement> & { tone?: 'info' | 'warn' | 'danger' | 'good' }) {
  const tones = { info: 'border-blue-200 bg-blue-50 text-navy', warn: 'border-amber-200 bg-amber-50 text-amber-900', danger: 'border-red-200 bg-red-50 text-red-900', good: 'border-green-200 bg-green-50 text-green-900' };
  return <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('rounded-xl border p-4 text-sm', tones[tone], className)} {...props} />;
}
export function Progress({ value, label }: { value: number; label: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} className="h-2 w-full overflow-hidden rounded-full bg-line">
      <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${v}%` }} />
    </div>
  );
}
