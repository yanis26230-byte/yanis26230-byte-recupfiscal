'use client';

import * as React from 'react';
import { Alert } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type Result = { ok: boolean; message?: string };

/** Formulaire du back-office : appelle une action serveur et affiche son résultat. */
export function ActionForm({ action, children, className, confirmText }: { action: (fd: FormData) => Promise<Result>; children: React.ReactNode; className?: string; confirmText?: string }) {
  const [res, setRes] = React.useState<Result | null>(null);
  const [pending, start] = React.useTransition();
  return (
    <form className={cn('space-y-2', className)} onSubmit={(e) => {
      e.preventDefault(); // conserve les saisies en cas d'erreur (une action React vide le formulaire)
      if (confirmText && !confirm(confirmText)) return;
      const fd = new FormData(e.currentTarget);
      start(async () => setRes(await action(fd)));
    }}>
      <fieldset disabled={pending} className="space-y-2">{children}</fieldset>
      {res && <Alert tone={res.ok ? 'good' : 'danger'} data-testid="admin-result">{res.message ?? (res.ok ? 'Fait.' : 'Erreur')}</Alert>}
    </form>
  );
}

/** Bouton d'action unique (ex. valider, publier). */
export function ActionButton({ action, label, variant = 'primary', confirmText }: { action: () => Promise<Result>; label: string; variant?: 'primary' | 'secondary'; confirmText?: string }) {
  const [res, setRes] = React.useState<Result | null>(null);
  const [pending, start] = React.useTransition();
  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" disabled={pending} onClick={() => { if (confirmText && !confirm(confirmText)) return; start(async () => setRes(await action())); }}
        className={cn('min-h-9 rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-50', variant === 'primary' ? 'bg-brand text-white' : 'border border-line bg-white')}>
        {pending ? '…' : label}
      </button>
      {res && <span role="status" data-testid="admin-result" className={cn('text-xs', res.ok ? 'text-money' : 'text-danger')}>{res.message ?? (res.ok ? 'Fait.' : 'Erreur')}</span>}
    </span>
  );
}

export const inputCls = 'block w-full min-h-10 rounded-lg border border-line bg-white px-3 py-1.5 text-sm';
