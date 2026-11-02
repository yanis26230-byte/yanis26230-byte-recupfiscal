'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { captureLeadAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

const schema = z.object({
  email: z.string().trim().email('Adresse e-mail invalide'),
  firstName: z.string().trim().min(1, 'Prénom obligatoire').max(80),
  phone: z.string().trim().max(30).regex(/^[+\d\s().-]*$/, 'Numéro invalide'),
  consent: z.literal(true, { errorMap: () => ({ message: 'Votre consentement est nécessaire' }) }),
  website: z.string().max(200).optional(),
});
type Values = z.infer<typeof schema>;

export function LeadForm({ auditId, alreadyCaptured, devOutbox }: { auditId: string; alreadyCaptured: boolean; devOutbox: boolean }) {
  const [done, setDone] = React.useState<null | 'sent' | 'already' | string>(alreadyCaptured ? 'already' : null);
  const [error, setError] = React.useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: '', firstName: '', phone: '', website: '' } });

  if (done) {
    return (
      <Alert tone="good" data-testid="lead-done">
        Votre demande est enregistrée.{' '}
        {done === 'sent' && 'Un lien de connexion vient de vous être envoyé par e-mail : ouvrez-le, sur cet appareil ou un autre, pour accéder au détail.'}
        {done === 'already' && <>Pour accéder au détail, utilisez le lien reçu par e-mail ou <a href="/connexion" className="underline">demandez un nouveau lien</a>.</>}
        {done !== 'sent' && done !== 'already' && done}
        {devOutbox && done === 'sent' && <> <a href="/dev/emails" className="underline">Boîte d’envoi de développement</a></>}
      </Alert>
    );
  }
  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    const r = await captureLeadAction(auditId, v);
    if (r.ok) setDone(r.linkSent ? 'sent' : (r.message ?? 'already')); else setError(r.message);
  });
  return (
    <form onSubmit={onSubmit} className="space-y-3" noValidate>
      <Field label="Adresse e-mail" htmlFor="lead-email" error={errors.email?.message}><Input id="lead-email" type="email" autoComplete="email" {...register('email')} aria-invalid={!!errors.email} /></Field>
      <Field label="Prénom" htmlFor="lead-fn" error={errors.firstName?.message}><Input id="lead-fn" autoComplete="given-name" {...register('firstName')} aria-invalid={!!errors.firstName} /></Field>
      <Field label="Téléphone" htmlFor="lead-ph" hint="Facultatif" error={errors.phone?.message}><Input id="lead-ph" type="tel" autoComplete="tel" {...register('phone')} /></Field>
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="lead-web">Site web</label><input id="lead-web" tabIndex={-1} autoComplete="off" {...register('website')} />
      </div>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" className="mt-1 size-5 accent-brand" {...register('consent')} />
        <span>J’accepte d’être recontacté au sujet de cette estimation et que mes coordonnées soient conservées conformément à la <a href="/confidentialite" className="text-brand underline" target="_blank">politique de confidentialité</a>.</span>
      </label>
      {errors.consent && <p className="text-xs text-danger">{errors.consent.message}</p>}
      {error && <Alert tone="danger">{error}</Alert>}
      <Button type="submit" className="w-full" disabled={isSubmitting}>{isSubmitting ? 'Envoi…' : 'Accéder au détail'}</Button>
    </form>
  );
}
