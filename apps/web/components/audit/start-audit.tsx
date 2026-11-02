'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { z } from 'zod';
import { searchCompanyAction, startAuditAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Alert, Badge, Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { CompanyData } from '@/lib/company-search';
import { companySchema, establishmentSchema } from '@/lib/questionnaire';
import { SECTOR_LABELS, sectorFromNaf, type SectorId } from '@/lib/sectors';
import { isValidSiren, looksLikeSiren, normalizeSiren } from '@/lib/siren';

const formSchema = z.object({
  company: companySchema.extend({ siren: z.string().refine((s) => isValidSiren(s), 'Numéro SIREN invalide (9 chiffres)') }),
  establishments: z.array(establishmentSchema).min(1, 'Ajoutez au moins un établissement'),
});
type FormValues = z.infer<typeof formSchema>;

/** Convertisseurs tolérants : React Hook Form les applique aussi aux valeurs initiales (null). */
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const nullableText = (v: unknown) => (str(v).trim() === '' ? null : str(v).trim());
const nullableUpper = (v: unknown) => nullableText(v)?.toUpperCase() ?? null;
const digitsOrNull = (v: unknown) => (str(v).replace(/\s/g, '') === '' ? null : str(v).replace(/\s/g, ''));

let keyCounter = 0;
const newKey = () => `etab-${Date.now().toString(36)}-${(keyCounter++).toString(36)}`;

function fromCompany(c: CompanyData): FormValues {
  return {
    company: { siren: c.siren, legalName: c.legalName, legalForm: c.legalForm, nafCode: c.nafCode, sector: c.sector, createdOn: c.createdOn, headcountRange: c.headcountRange, source: 'api' },
    establishments: c.establishments.map((e) => ({ key: newKey(), siret: e.siret, address: e.address, postalCode: e.postalCode, city: e.city, inseeCode: e.inseeCode, concerned: true })),
  };
}

function blank(siren = ''): FormValues {
  return {
    company: { siren, legalName: '', legalForm: null, nafCode: null, sector: 'autre', createdOn: null, headcountRange: null, source: 'manuel' },
    establishments: [{ key: newKey(), siret: null, address: '', postalCode: '', city: '', inseeCode: null, concerned: true }],
  };
}

export function StartAudit() {
  const [query, setQuery] = React.useState('');
  const [searching, startSearch] = React.useTransition();
  const [results, setResults] = React.useState<CompanyData[] | null>(null);
  const [message, setMessage] = React.useState<{ tone: 'warn' | 'danger' | 'info'; text: string } | null>(null);
  const [form, setForm] = React.useState<{ values: FormValues; openCount: number | null } | null>(null);

  const search = (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    startSearch(async () => {
      const r = await searchCompanyAction(query);
      if (r.ok) {
        setResults(r.companies);
        if (!r.companies.length) setMessage({ tone: 'info', text: 'Aucune entreprise trouvée. Vérifiez votre saisie ou renseignez vos informations manuellement.' });
      } else {
        setResults(null);
        setMessage({ tone: r.reason === 'unavailable' ? 'warn' : 'danger', text: r.message });
        if (r.reason === 'unavailable') setForm({ values: blank(looksLikeSiren(query) ? normalizeSiren(query) : ''), openCount: null });
      }
    });
  };

  if (form) return <ConfirmForm initial={form.values} openCount={form.openCount} notice={message} onBack={() => { setForm(null); setMessage(null); }} />;

  return (
    <div className="mt-6 space-y-4">
      <form onSubmit={search} className="space-y-3" role="search">
        <Field label="Numéro SIREN ou nom de l’entreprise" htmlFor="q" hint="Exemple : 552 100 554 ou « Boulangerie Martin Lyon »">
          <Input id="q" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="organization" required minLength={3} maxLength={120} />
        </Field>
        <Button type="submit" className="w-full sm:w-auto" disabled={searching}>{searching ? 'Recherche…' : 'Rechercher'}</Button>
      </form>
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      {results && results.length > 0 && (
        <ul className="space-y-3" aria-label="Entreprises trouvées">
          {results.map((c) => (
            <li key={c.siren}>
              <button type="button" onClick={() => setForm({ values: fromCompany(c), openCount: c.openEstablishmentsCount })}
                className="w-full rounded-2xl border border-line bg-white p-4 text-left hover:border-brand focus:outline-none focus:ring-2 focus:ring-brand">
                <span className="block font-semibold">{c.legalName}</span>
                <span className="mt-1 block text-sm text-muted">SIREN {c.siren} · {c.nafCode ?? 'NAF inconnu'} · {c.establishments[0]?.city ?? ''}</span>
                {!c.isActive && <Badge tone="warn" className="mt-2">Entreprise fermée</Badge>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-muted">
        Vous préférez saisir vos informations ?{' '}
        <button type="button" className="font-medium text-brand underline" onClick={() => setForm({ values: blank(looksLikeSiren(query) ? normalizeSiren(query) : ''), openCount: null })}>Saisie manuelle</button>
      </p>
    </div>
  );
}

function ConfirmForm({ initial, openCount, notice, onBack }: { initial: FormValues; openCount: number | null; notice: { tone: 'warn' | 'danger' | 'info'; text: string } | null; onBack: () => void }) {
  const { register, control, handleSubmit, setValue, watch, formState: { errors, isSubmitting } } = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: initial });
  const { fields, append, remove } = useFieldArray({ control, name: 'establishments', keyName: 'fieldKey' });
  const [serverError, setServerError] = React.useState<string | null>(null);
  const manual = initial.company.source === 'manuel';
  const naf = watch('company.nafCode');
  React.useEffect(() => { setValue('company.sector', sectorFromNaf(naf)); }, [naf, setValue]);
  const nullable = { setValueAs: nullableText };

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    const r = await startAuditAction(values);
    if (r && !r.ok) setServerError(r.message);
  });

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-5" noValidate>
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <Card className="space-y-4">
        <h2 className="text-lg font-semibold">{manual ? 'Vos informations' : 'Vérifiez les informations'}</h2>
        <Field label="Numéro SIREN" htmlFor="siren" error={errors.company?.siren?.message}>
          <Input id="siren" inputMode="numeric" readOnly={!manual} {...register('company.siren', { setValueAs: (v: unknown) => normalizeSiren(str(v)) })} aria-invalid={!!errors.company?.siren} />
        </Field>
        <Field label="Raison sociale" htmlFor="legalName" error={errors.company?.legalName?.message}>
          <Input id="legalName" {...register('company.legalName')} aria-invalid={!!errors.company?.legalName} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Forme juridique" htmlFor="legalForm"><Input id="legalForm" {...register('company.legalForm', nullable)} /></Field>
          <Field label="Code NAF" htmlFor="naf" hint={`Secteur : ${SECTOR_LABELS[watch('company.sector') as SectorId]}`} error={errors.company?.nafCode?.message}>
            <Input id="naf" placeholder="ex. 43.22A" {...register('company.nafCode', { setValueAs: nullableUpper })} />
          </Field>
          <Field label="Date de création" htmlFor="createdOn"><Input id="createdOn" type="date" {...register('company.createdOn', nullable)} /></Field>
          <Field label="Tranche d’effectif (registre)" htmlFor="hc"><Input id="hc" {...register('company.headcountRange', nullable)} /></Field>
        </div>
      </Card>

      <Card className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Établissements</h2>
          <p className="text-sm text-muted">Cochez les établissements à inclure dans l’estimation.</p>
          {openCount !== null && openCount > fields.length && (
            <Alert tone="info" className="mt-3">Le registre indique {openCount} établissements ouverts ; {fields.length} sont listés ici. Ajoutez ceux qui manquent si besoin.</Alert>
          )}
        </div>
        {fields.map((f, i) => (
          <fieldset key={f.fieldKey} className="space-y-3 rounded-xl border border-line p-4">
            <legend className="sr-only">Établissement {i + 1}</legend>
            <label className="flex items-center gap-3 font-medium">
              <input type="checkbox" className="size-5 accent-brand" {...register(`establishments.${i}.concerned`)} /> Inclure cet établissement
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="SIRET" htmlFor={`siret-${i}`} error={errors.establishments?.[i]?.siret?.message} hint="Facultatif">
                <Input id={`siret-${i}`} inputMode="numeric" {...register(`establishments.${i}.siret`, { setValueAs: digitsOrNull })} />
              </Field>
              <Field label="Adresse" htmlFor={`addr-${i}`}><Input id={`addr-${i}`} {...register(`establishments.${i}.address`)} /></Field>
              <Field label="Code postal" htmlFor={`cp-${i}`} error={errors.establishments?.[i]?.postalCode?.message}><Input id={`cp-${i}`} inputMode="numeric" {...register(`establishments.${i}.postalCode`)} /></Field>
              <Field label="Commune" htmlFor={`city-${i}`}><Input id={`city-${i}`} {...register(`establishments.${i}.city`)} /></Field>
              <Field label="Code commune INSEE" htmlFor={`insee-${i}`} hint="Facultatif, différent du code postal" error={errors.establishments?.[i]?.inseeCode ? 'Code INSEE : 5 caractères' : undefined}>
                <Input id={`insee-${i}`} {...register(`establishments.${i}.inseeCode`, { setValueAs: nullableUpper })} />
              </Field>
            </div>
            {fields.length > 1 && <Button type="button" variant="link" onClick={() => remove(i)}>Retirer cet établissement</Button>}
          </fieldset>
        ))}
        {errors.establishments?.message && <p className="text-sm text-danger">{errors.establishments.message}</p>}
        <Button type="button" variant="secondary" onClick={() => append({ key: newKey(), siret: null, address: '', postalCode: '', city: '', inseeCode: null, concerned: true })}>Ajouter un établissement</Button>
      </Card>
      <input type="hidden" {...register('company.sector')} />
      {serverError && <Alert tone="danger">{serverError}</Alert>}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        <Button type="button" variant="ghost" onClick={onBack}>Revenir à la recherche</Button>
        <Button type="submit" size="lg" disabled={isSubmitting}>{isSubmitting ? 'Création…' : 'Confirmer et commencer'}</Button>
      </div>
    </form>
  );
}

