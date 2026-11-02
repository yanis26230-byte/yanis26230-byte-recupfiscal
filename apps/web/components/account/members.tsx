'use client';

import * as React from 'react';
import { changeRoleAction, inviteMemberAction, removeMemberAction, revokeInvitationAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Alert, Badge } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';

const ROLES = [
  { v: 'proprietaire', label: 'Propriétaire' },
  { v: 'collaborateur', label: 'Collaborateur' },
  { v: 'comptable_invite', label: 'Comptable invité' },
];

export function MemberRow({ companyId, member, isOwner, isMe }: { companyId: string; member: { user_id: string; email: string; role: string }; isOwner: boolean; isMe: boolean }) {
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const run = (fn: () => Promise<{ ok: boolean; message?: string } | undefined | void>) => start(async () => {
    setError(null);
    const r = await fn();
    if (r && !r.ok) setError(r.message ?? 'Erreur');
  });
  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm">{member.email} {isMe && <Badge>vous</Badge>}</span>
        {isOwner ? (
          <Select aria-label={`Rôle de ${member.email}`} className="w-auto" value={member.role} disabled={pending}
            onChange={(e) => run(() => changeRoleAction(companyId, member.user_id, e.target.value))}>
            {ROLES.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}
          </Select>
        ) : <Badge tone="info">{ROLES.find((r) => r.v === member.role)?.label}</Badge>}
      </div>
      {(isOwner || isMe) && (
        <Button variant="link" disabled={pending} onClick={() => {
          if (confirm(isMe ? 'Quitter cette entreprise ?' : `Retirer ${member.email} de l’entreprise ?`)) run(() => removeMemberAction(companyId, member.user_id));
        }}>{isMe ? 'Quitter l’entreprise' : 'Retirer'}</Button>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
    </li>
  );
}

export function InviteForm({ companyId }: { companyId: string }) {
  const [email, setEmail] = React.useState('');
  const [role, setRole] = React.useState('collaborateur');
  const [state, setState] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = React.useTransition();
  return (
    <form className="space-y-3" onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        const r = await inviteMemberAction(companyId, { email, role });
        setState({ ok: r.ok, text: r.ok ? (r.message ?? 'Invitation envoyée.') : r.message });
        if (r.ok) setEmail('');
      });
    }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Adresse e-mail" htmlFor="inv-email"><Input id="inv-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Rôle" htmlFor="inv-role" hint="Le comptable invité peut consulter et déposer des documents, sans rien modifier.">
          <Select id="inv-role" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="collaborateur">Collaborateur</option>
            <option value="comptable_invite">Comptable invité</option>
          </Select>
        </Field>
      </div>
      <Button type="submit" disabled={pending}>{pending ? 'Envoi…' : 'Envoyer l’invitation'}</Button>
      {state && <Alert tone={state.ok ? 'good' : 'danger'} data-testid="invite-state">{state.text}</Alert>}
    </form>
  );
}

export function RevokeInvitationButton({ companyId, invitationId }: { companyId: string; invitationId: string }) {
  const [pending, start] = React.useTransition();
  return <Button variant="link" disabled={pending} onClick={() => start(async () => { await revokeInvitationAction(companyId, invitationId); })}>Annuler</Button>;
}
