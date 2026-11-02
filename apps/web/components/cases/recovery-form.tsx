'use client';

import * as React from 'react';
import { startRecoveryAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

export function RecoveryForm({ companyId, auditId, email }: { companyId: string; auditId: string; email: string }) {
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  return (
    <Card>
      {/* onSubmit (et non action) : React vide le formulaire après une action, même en erreur. */}
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); start(async () => {
        setError(null);
        const r = await startRecoveryAction({ companyId, auditId, signerFirstName: fd.get('fn'), signerLastName: fd.get('ln'), signerFunction: fd.get('fx'),
          declaration: fd.get('declaration') === 'on', acceptTerms: fd.get('accept') === 'on' });
        if (r && !r.ok) setError(r.message);
      }); }}>
        <h2 className="font-semibold">Signataire du mandat</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Prénom" htmlFor="fn"><Input id="fn" name="fn" required autoComplete="given-name" /></Field>
          <Field label="Nom" htmlFor="ln"><Input id="ln" name="ln" required autoComplete="family-name" /></Field>
          <Field label="Fonction" htmlFor="fx" hint="Ex. gérant, président"><Input id="fx" name="fx" required /></Field>
        </div>
        <p className="text-sm text-muted">Le mandat sera envoyé pour signature à {email}.</p>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" name="declaration" className="mt-1 size-5 accent-brand" /> Je déclare être habilité(e) à engager l’entreprise.</label>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" name="accept" className="mt-1 size-5 accent-brand" /> J’ai lu et j’accepte les conditions ci-dessus.</label>
        {error && <Alert tone="danger">{error}</Alert>}
        <Button type="submit" size="lg" className="w-full" disabled={pending}>{pending ? 'Ouverture du dossier…' : 'Ouvrir mon dossier et préparer le mandat'}</Button>
      </form>
    </Card>
  );
}
