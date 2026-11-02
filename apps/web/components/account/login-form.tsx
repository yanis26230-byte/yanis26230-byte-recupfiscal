'use client';

import * as React from 'react';
import { requestLoginLinkAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

export function LoginForm({ next, defaultEmail, devOutbox }: { next: string; defaultEmail?: string; devOutbox: boolean }) {
  const [email, setEmail] = React.useState(defaultEmail ?? '');
  const [state, setState] = React.useState<{ tone: 'good' | 'danger'; text: string } | null>(null);
  const [pending, start] = React.useTransition();
  return (
    <form className="space-y-4" onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        const r = await requestLoginLinkAction(email, next);
        setState(r.ok ? { tone: 'good', text: `Si cette adresse est valide, un lien de connexion vient d’y être envoyé. Il est valable 15 minutes.` } : { tone: 'danger', text: r.message });
      });
    }}>
      <Field label="Adresse e-mail" htmlFor="login-email"><Input id="login-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Button type="submit" className="w-full" disabled={pending}>{pending ? 'Envoi…' : 'Recevoir un lien de connexion'}</Button>
      {state && <Alert tone={state.tone} data-testid="login-state">{state.text}{state.tone === 'good' && devOutbox && <> <a href="/dev/emails" className="underline">Boîte d’envoi de développement</a></>}</Alert>}
    </form>
  );
}
