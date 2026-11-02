'use client';

import * as React from 'react';
import { acceptInvitationAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/card';

export function AcceptInvitation({ token }: { token: string }) {
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  return (
    <div className="space-y-3">
      <Button className="w-full" disabled={pending} onClick={() => start(async () => { const r = await acceptInvitationAction(token); if (r && !r.ok) setError(r.message); })}>
        {pending ? 'Acceptation…' : 'Accepter l’invitation'}
      </Button>
      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  );
}
