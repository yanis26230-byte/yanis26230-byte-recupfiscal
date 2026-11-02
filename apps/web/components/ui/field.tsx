'use client';
import * as React from 'react';
import { parseFrNumber } from '@/lib/questionnaire';
import { cn } from '@/lib/utils';
import { Input } from './input';

export function Field({ label, hint, error, htmlFor, children, className }: { label: React.ReactNode; hint?: React.ReactNode; error?: string; htmlFor: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-navy">{label}</label>
      {children}
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && <p className="text-xs text-danger" role="alert">{error}</p>}
    </div>
  );
}

/** Saisie numérique « à la française » (virgule décimale, espaces), valeur null si vide. */
export function NumberInput({ value, onChange, id, suffix, integer, min, max, placeholder, ariaLabel }: {
  value: number | null; onChange: (v: number | null) => void; id: string; suffix?: string; integer?: boolean; min?: number; max?: number; placeholder?: string; ariaLabel?: string;
}) {
  const fmt = (v: number | null) => (v === null ? '' : String(v).replace('.', ','));
  const [text, setText] = React.useState(fmt(value));
  const [invalid, setInvalid] = React.useState(false);
  React.useEffect(() => {
    if (parseFrNumber(text) !== value) setText(fmt(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className="relative">
      <Input
        id={id}
        inputMode={integer ? 'numeric' : 'decimal'}
        value={text}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={invalid}
        className={suffix ? 'pr-10' : undefined}
        onChange={(e) => {
          setText(e.target.value);
          const n = parseFrNumber(e.target.value);
          const bad = (e.target.value.trim() !== '' && n === null) || (n !== null && ((integer && !Number.isInteger(n)) || (min !== undefined && n < min) || (max !== undefined && n > max)));
          setInvalid(bad);
          if (!bad) onChange(n);
        }}
      />
      {suffix && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted">{suffix}</span>}
    </div>
  );
}
