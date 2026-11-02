'use client';

import * as React from 'react';
import { uploadCaseDocumentAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/card';

export function UploadCaseDocument({ companyId, caseId }: { companyId: string; caseId: string }) {
  const [state, setState] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = React.useTransition();
  return (
    <form className="space-y-2" action={(fd) => start(async () => { const r = await uploadCaseDocumentAction(companyId, caseId, fd); setState({ ok: r.ok, text: r.ok ? (r.message ?? 'Déposé.') : r.message }); })}>
      <label htmlFor="case-file" className="text-sm font-medium">Déposer un justificatif</label>
      <input id="case-file" name="fichier" type="file" required accept=".pdf,.csv,.xlsx,.txt" className="block w-full rounded-lg border border-line bg-white p-2 text-sm" />
      <Button type="submit" size="sm" disabled={pending}>{pending ? 'Envoi…' : 'Déposer'}</Button>
      {state && <Alert tone={state.ok ? 'good' : 'danger'}>{state.text}</Alert>}
    </form>
  );
}
