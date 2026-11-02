'use client';

import { useRouter } from 'next/navigation';
import * as React from 'react';
import { uploadDocumentAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/card';

export function UploadForm({ companyId }: { companyId: string }) {
  const router = useRouter();
  const [state, setState] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = React.useTransition();
  const ref = React.useRef<HTMLFormElement>(null);
  return (
    <form ref={ref} className="space-y-3" action={(fd) => start(async () => {
      const r = await uploadDocumentAction(companyId, fd);
      setState({ ok: r.ok, text: r.ok ? (r.message ?? 'Document reçu.') : r.message });
      if (r.ok) { ref.current?.reset(); setTimeout(() => router.refresh(), 1500); }
    })}>
      <label className="block text-sm font-medium" htmlFor="fichier">Fichier</label>
      <input id="fichier" name="fichier" type="file" required accept=".pdf,.csv,.xlsx,.txt,.dsn,application/pdf,text/csv"
        className="block w-full rounded-lg border border-line bg-white p-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-surface file:px-3 file:py-2" />
      <Button type="submit" disabled={pending}>{pending ? 'Envoi…' : 'Déposer'}</Button>
      {state && <Alert tone={state.ok ? 'good' : 'danger'} data-testid="upload-state">{state.text}</Alert>}
    </form>
  );
}
