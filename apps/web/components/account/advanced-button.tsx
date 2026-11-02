'use client';

import * as React from 'react';
import { startAdvancedAuditAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/card';

export function AdvancedAuditButton({ companyId }: { companyId: string }) {
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  return (
    <div className="space-y-2">
      <Button disabled={pending} onClick={() => start(async () => { const r = await startAdvancedAuditAction(companyId); if (r && !r.ok) setError(r.message); })}>
        {pending ? 'Préparation…' : 'Lancer une analyse avancée'}
      </Button>
      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  );
}
