'use client';

import * as React from 'react';
import { deleteMyAccountAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

export function DeleteAccount({ email }: { email: string }) {
  const [value, setValue] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await deleteMyAccountAction(value); if (r && !r.ok) setError(r.message); }); }}>
      <Field label={`Pour confirmer, saisissez ${email}`} htmlFor="del-confirm"><Input id="del-confirm" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" /></Field>
      <Button type="submit" variant="secondary" className="border-red-300 text-danger" disabled={pending || value.trim().toLowerCase() !== email.toLowerCase()}>{pending ? 'Suppression…' : 'Supprimer définitivement mon compte'}</Button>
      {error && <Alert tone="danger">{error}</Alert>}
    </form>
  );
}
