'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { Field, NumberInput } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import {
  BRACKETS, CONSENT_TEXT, CONSENT_TEXT_VERSION, SCHEMES, STEPS, formatEur, submissionIssues,
  type AuditMeta, type BracketId, type Issue, type StepAnswers,
} from '@/lib/questionnaire';
import { SECTOR_LABELS, type StepId } from '@/lib/sectors';
import { cn } from '@/lib/utils';

export interface StepProps {
  step: StepId;
  answers: StepAnswers;
  meta: AuditMeta;
  annualSmic: Record<string, number | null>;
  update: <K extends StepId>(id: K, value: StepAnswers[K]) => void;
  goTo: (index: number) => void;
  issues: Issue[];
}

export function StepView(props: StepProps) {
  switch (props.step) {
    case 'entreprise': return <EntrepriseStep {...props} />;
    case 'salaires': return <SalairesStep {...props} />;
    case 'reduction': return <ReductionStep {...props} />;
    case 'taux_at': return <TauxAtStep {...props} />;
    case 'alternance': return <AlternanceStep {...props} />;
    case 'dispositifs': return <DispositifsStep {...props} />;
    case 'recapitulatif': return <RecapStep {...props} />;
  }
}

function YearTabs({ years, value, onChange }: { years: number[]; value: number; onChange: (y: number) => void }) {
  return (
    <div role="tablist" aria-label="Année" className="flex gap-2 overflow-x-auto pb-1">
      {years.map((y) => (
        <button key={y} role="tab" type="button" aria-selected={y === value} onClick={() => onChange(y)}
          className={cn('min-h-11 rounded-lg border px-4 text-sm font-semibold', y === value ? 'border-brand bg-brand text-white' : 'border-line bg-white text-navy')}>
          {y}
        </button>
      ))}
    </div>
  );
}

function EntrepriseStep({ answers, meta, update }: StepProps) {
  const e = answers.entreprise;
  const set = (patch: Partial<typeof e>) => update('entreprise', { ...e, ...patch });
  return (
    <div className="space-y-5">
      <Card>
        <p className="text-sm text-muted">Entreprise</p>
        <p className="mt-1 text-lg font-semibold">{e.company.legalName}</p>
        <p className="text-sm text-muted">SIREN {e.company.siren} · {e.company.legalForm ?? 'Forme juridique non renseignée'} · {e.company.nafCode ?? 'NAF non renseigné'} · {SECTOR_LABELS[e.company.sector]}</p>
      </Card>
      <Card className="space-y-4">
        <h2 className="font-semibold">Effectif moyen par année</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {meta.years.map((y) => (
            <Field key={y} label={`Effectif moyen ${y}`} htmlFor={`hc-${y}`} hint={y === meta.years.at(-1) ? 'Année en cours : estimation' : undefined}>
              <NumberInput id={`hc-${y}`} value={e.headcountByYear[String(y)] ?? null} min={0} max={10000} suffix="sal."
                onChange={(v) => set({ headcountByYear: { ...e.headcountByYear, [String(y)]: v } })} />
            </Field>
          ))}
        </div>
      </Card>
      <Card className="space-y-3">
        <h2 className="font-semibold">Établissements concernés</h2>
        {e.establishments.map((est, i) => (
          <label key={est.key} className="flex items-start gap-3 rounded-xl border border-line p-3">
            <input type="checkbox" className="mt-1 size-5 accent-brand" checked={est.concerned}
              onChange={(ev) => set({ establishments: e.establishments.map((x, j) => (j === i ? { ...x, concerned: ev.target.checked } : x)) })} />
            <span>
              <span className="block font-medium">{est.city || 'Établissement'} {est.siret ? `· SIRET ${est.siret}` : ''}</span>
              <span className="block text-sm text-muted">{est.address} {est.postalCode}</span>
            </span>
          </label>
        ))}
      </Card>
    </div>
  );
}

function SalairesStep({ answers, meta, annualSmic, update }: StepProps) {
  const [year, setYear] = React.useState(meta.years[0]!);
  const s = answers.salaires;
  const y = s.years[String(year)]!;
  const headcount = answers.entreprise.headcountByYear[String(year)];
  const total = Object.values(y.brackets).reduce((a, b) => a + b.count, 0);
  const smic = annualSmic[String(year)];
  const setYearData = (data: typeof y) => update('salaires', { years: { ...s.years, [String(year)]: data } });
  const setBracket = (id: BracketId, patch: Partial<(typeof y.brackets)[BracketId]>) =>
    setYearData({ ...y, brackets: { ...y.brackets, [id]: { count: 0, partTimeSharePct: 0, partTimeRatioPct: null, ...y.brackets[id], ...patch } } });
  const prev = meta.years[meta.years.indexOf(year) - 1];

  return (
    <div className="space-y-5">
      <YearTabs years={meta.years} value={year} onChange={setYear} />
      <p className="text-sm text-muted">
        Pour {year}, indiquez le nombre de salariés dans chaque tranche de salaire brut annuel <strong>équivalent temps plein</strong>.
        {smic === null && ' L’équivalent en euros sera affiché dès que le SMIC de cette année aura été validé dans la plateforme.'}
      </p>
      {prev !== undefined && (
        <Button variant="secondary" size="sm" onClick={() => setYearData(structuredClone(s.years[String(prev)]!))}>Recopier les réponses {prev}</Button>
      )}
      <div className="space-y-3">
        {BRACKETS.map((b) => {
          const v = y.brackets[b.id] ?? { count: 0, partTimeSharePct: 0, partTimeRatioPct: null };
          return (
            <Card key={b.id} className="p-4 sm:p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-1">
                <p className="font-semibold">{b.label}</p>
                {smic !== null && smic !== undefined && (
                  <p className="text-sm text-muted tabular" data-testid={`euros-${b.id}`}>
                    {b.high === null ? `plus de ${formatEur(b.low * smic)}` : `${formatEur(b.low * smic)} à ${formatEur(b.high * smic)}`} brut/an
                  </p>
                )}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-3">
                <Field label="Salariés" htmlFor={`n-${year}-${b.id}`}>
                  <NumberInput id={`n-${year}-${b.id}`} integer min={0} max={5000} value={v.count} onChange={(n) => setBracket(b.id, { count: n ?? 0 })} />
                </Field>
                <Field label="Dont temps partiel" htmlFor={`tp-${year}-${b.id}`}>
                  <NumberInput id={`tp-${year}-${b.id}`} min={0} max={100} suffix="%" value={v.partTimeSharePct} onChange={(n) => setBracket(b.id, { partTimeSharePct: n ?? 0 })} />
                </Field>
                <Field label="Quotité moy." htmlFor={`q-${year}-${b.id}`}>
                  <NumberInput id={`q-${year}-${b.id}`} min={1} max={100} suffix="%" placeholder="?" value={v.partTimeRatioPct} onChange={(n) => setBracket(b.id, { partTimeRatioPct: n })} />
                </Field>
              </div>
            </Card>
          );
        })}
      </div>
      <p className={cn('text-sm', headcount != null && Math.abs(total - headcount) > Math.max(2, 0.2 * headcount) ? 'text-amber-800' : 'text-muted')} data-testid="bracket-total">
        Total réparti : {total} salarié(s){headcount != null ? ` pour un effectif moyen de ${headcount}` : ''}.
      </p>
      <Card className="grid gap-4 sm:grid-cols-2">
        <Field label={`Heures supplémentaires ${year} (approximatif)`} htmlFor={`hs-${year}`} hint="Volume annuel pour toute l’entreprise, facultatif">
          <NumberInput id={`hs-${year}`} min={0} suffix="h" value={y.overtimeHours} onChange={(n) => setYearData({ ...y, overtimeHours: n })} />
        </Field>
        <Field label={`Masse salariale brute ${year} (approximatif)`} htmlFor={`ms-${year}`} hint="Facultatif">
          <NumberInput id={`ms-${year}`} min={0} suffix="€" value={y.payrollMass} onChange={(n) => setYearData({ ...y, payrollMass: n })} />
        </Field>
      </Card>
    </div>
  );
}

function ReductionStep({ answers, meta, update }: StepProps) {
  const r = answers.reduction;
  return (
    <div className="space-y-4">
      {meta.years.map((y) => {
        const v = r.years[String(y)]!;
        const set = (patch: Partial<typeof v>) => update('reduction', { ...r, years: { ...r.years, [String(y)]: { ...v, ...patch } } });
        return (
          <Card key={y} className="space-y-3">
            <h2 className="font-semibold">Réduction générale appliquée en {y}</h2>
            <Field label="Montant annuel" htmlFor={`red-${y}`} hint={y === meta.years.at(-1) ? 'Année en cours : montant prévu sur l’année' : undefined}>
              <NumberInput id={`red-${y}`} min={0} suffix="€" value={v.known ? v.amount : null} onChange={(n) => set({ known: true, amount: n })} />
            </Field>
            <label className="flex items-center gap-3 text-sm">
              <input type="checkbox" className="size-5 accent-brand" checked={!v.known} onChange={(e) => set(e.target.checked ? { known: false, amount: null } : { known: true })} />
              Je ne sais pas
            </label>
          </Card>
        );
      })}
      <Card>
        <Field label="Logiciel ou prestataire de paie" htmlFor="provider" hint="Facultatif">
          <Input id="provider" maxLength={100} value={r.payrollProvider ?? ''} onChange={(e) => update('reduction', { ...r, payrollProvider: e.target.value || null })} />
        </Field>
      </Card>
    </div>
  );
}

function TauxAtStep({ answers, meta, update }: StepProps) {
  const t = answers.taux_at;
  const establishments = answers.entreprise.establishments.filter((e) => e.concerned);
  // Ajoute les lignes manquantes (établissement coché après coup).
  const rates = establishments.flatMap((e) => meta.years.map((year) =>
    t.rates.find((r) => r.establishmentKey === e.key && r.year === year) ?? { establishmentKey: e.key, year, appliedRatePct: null, notifiedRatePct: null, payrollMass: null }));
  const set = (key: string, year: number, patch: Partial<(typeof rates)[number]>) =>
    update('taux_at', { rates: rates.map((r) => (r.establishmentKey === key && r.year === year ? { ...r, ...patch } : r)) });
  return (
    <div className="space-y-4">
      <Alert tone="info">Sans la notification officielle de taux, nous signalons seulement une anomalie à vérifier : aucune conclusion ferme n’est tirée en mode rapide.</Alert>
      {establishments.map((e) => (
        <Card key={e.key} className="space-y-4">
          <h2 className="font-semibold">{e.city || 'Établissement'} {e.siret ? `· ${e.siret}` : ''}</h2>
          {meta.years.map((y) => {
            const r = rates.find((x) => x.establishmentKey === e.key && x.year === y)!;
            return (
              <fieldset key={y} className="grid gap-3 border-t border-line pt-3 sm:grid-cols-3">
                <legend className="text-sm font-semibold">{y}</legend>
                <Field label="Taux appliqué en paie" htmlFor={`at-a-${e.key}-${y}`}>
                  <NumberInput id={`at-a-${e.key}-${y}`} min={0} max={30} suffix="%" placeholder="ex. 2,10" value={r.appliedRatePct} onChange={(n) => set(e.key, y, { appliedRatePct: n })} />
                </Field>
                <Field label="Taux notifié (si connu)" htmlFor={`at-n-${e.key}-${y}`}>
                  <NumberInput id={`at-n-${e.key}-${y}`} min={0} max={30} suffix="%" value={r.notifiedRatePct} onChange={(n) => set(e.key, y, { notifiedRatePct: n })} />
                </Field>
                {establishments.length > 1 && (
                  <Field label="Masse salariale de l’établissement" htmlFor={`at-m-${e.key}-${y}`}>
                    <NumberInput id={`at-m-${e.key}-${y}`} min={0} suffix="€" value={r.payrollMass} onChange={(n) => set(e.key, y, { payrollMass: n })} />
                  </Field>
                )}
              </fieldset>
            );
          })}
        </Card>
      ))}
    </div>
  );
}

const DIPLOMA_LEVELS = [
  { v: 3, label: 'Niveau 3 (CAP, BEP)' }, { v: 4, label: 'Niveau 4 (bac, bac pro, BP)' }, { v: 5, label: 'Niveau 5 (bac+2 : BTS, BUT 2e année)' },
  { v: 6, label: 'Niveau 6 (bac+3 : licence, BUT)' }, { v: 7, label: 'Niveau 7 (bac+5 : master, ingénieur)' }, { v: 8, label: 'Niveau 8 (doctorat)' },
];

function AlternanceStep({ answers, update }: StepProps) {
  const a = answers.alternance;
  const set = (contracts: typeof a.contracts) => update('alternance', { contracts });
  const add = () => set([...a.contracts, { id: `C${Date.now().toString(36)}`, contractType: 'apprentissage', startMonth: '', durationMonths: 24, diplomaLevel: null, aidReceived: 'inconnu', aidAmountReceived: null }]);
  return (
    <div className="space-y-4">
      {a.contracts.length === 0 && <p className="text-muted">Aucun contrat renseigné. Ajoutez vos apprentis et contrats de professionnalisation des dernières années.</p>}
      {a.contracts.map((c, i) => {
        const patch = (p: Partial<typeof c>) => set(a.contracts.map((x, j) => (j === i ? { ...x, ...p } : x)));
        return (
          <Card key={c.id} className="space-y-3">
            <h2 className="font-semibold">Contrat {i + 1}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Type de contrat" htmlFor={`ct-${c.id}`}>
                <Select id={`ct-${c.id}`} value={c.contractType} onChange={(e) => patch({ contractType: e.target.value as typeof c.contractType })}>
                  <option value="apprentissage">Apprentissage</option>
                  <option value="professionnalisation">Professionnalisation</option>
                </Select>
              </Field>
              <Field label="Mois de début" htmlFor={`sm-${c.id}`} hint="Approximatif">
                <Input id={`sm-${c.id}`} type="month" value={c.startMonth} onChange={(e) => patch({ startMonth: e.target.value })} />
              </Field>
              <Field label="Durée du contrat" htmlFor={`du-${c.id}`}>
                <NumberInput id={`du-${c.id}`} integer min={1} max={48} suffix="mois" value={c.durationMonths} onChange={(n) => patch({ durationMonths: n ?? 1 })} />
              </Field>
              <Field label="Diplôme préparé" htmlFor={`dl-${c.id}`}>
                <Select id={`dl-${c.id}`} value={c.diplomaLevel ?? ''} onChange={(e) => patch({ diplomaLevel: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">Je ne sais pas</option>
                  {DIPLOMA_LEVELS.map((d) => <option key={d.v} value={d.v}>{d.label}</option>)}
                </Select>
              </Field>
              <Field label="Aide déjà perçue" htmlFor={`ar-${c.id}`}>
                <Select id={`ar-${c.id}`} value={c.aidReceived} onChange={(e) => patch({ aidReceived: e.target.value as typeof c.aidReceived, aidAmountReceived: e.target.value === 'non' ? null : c.aidAmountReceived })}>
                  <option value="oui">Oui</option><option value="non">Non</option><option value="partiellement">Partiellement</option><option value="inconnu">Je ne sais pas</option>
                </Select>
              </Field>
              {(c.aidReceived === 'oui' || c.aidReceived === 'partiellement') && (
                <Field label="Montant perçu (si connu)" htmlFor={`am-${c.id}`}>
                  <NumberInput id={`am-${c.id}`} min={0} suffix="€" value={c.aidAmountReceived} onChange={(n) => patch({ aidAmountReceived: n })} />
                </Field>
              )}
            </div>
            <Button variant="link" onClick={() => set(a.contracts.filter((_, j) => j !== i))}>Supprimer ce contrat</Button>
          </Card>
        );
      })}
      <Button variant="secondary" onClick={add}>Ajouter un contrat</Button>
    </div>
  );
}

function DispositifsStep({ answers, update }: StepProps) {
  const d = answers.dispositifs;
  const sim = d.simulation;
  const setSim = (p: Partial<typeof sim>) => update('dispositifs', { ...d, simulation: { ...sim, ...p } });
  return (
    <div className="space-y-4">
      <Card className="space-y-4">
        <h2 className="font-semibold">Dispositifs déjà en place</h2>
        {SCHEMES.map((s) => {
          const v = d.schemes[s.id] ?? { active: null, annualAmount: null };
          const set = (p: Partial<typeof v>) => update('dispositifs', { ...d, schemes: { ...d.schemes, [s.id]: { ...v, ...p } } });
          return (
            <fieldset key={s.id} className="space-y-2 border-t border-line pt-3 first:border-0 first:pt-0">
              <legend className="text-sm font-medium">{s.label}</legend>
              <div className="flex flex-wrap gap-2">
                {([[true, 'Oui'], [false, 'Non'], [null, 'Je ne sais pas']] as const).map(([val, lab]) => (
                  <label key={lab} className={cn('flex min-h-11 cursor-pointer items-center rounded-lg border px-3 text-sm', v.active === val ? 'border-brand bg-blue-50' : 'border-line')}>
                    <input type="radio" className="sr-only" name={`sch-${s.id}`} checked={v.active === val} onChange={() => set({ active: val, annualAmount: val ? v.annualAmount : null })} />{lab}
                  </label>
                ))}
              </div>
              {v.active && (
                <Field label="Montant annuel versé (si connu)" htmlFor={`sa-${s.id}`}>
                  <NumberInput id={`sa-${s.id}`} min={0} suffix="€" value={v.annualAmount} onChange={(n) => set({ annualAmount: n })} />
                </Field>
              )}
            </fieldset>
          );
        })}
      </Card>
      <Card className="space-y-4">
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-1 size-5 accent-brand" checked={sim.enabled} onChange={(e) => setSim({ enabled: e.target.checked })} />
          <span><span className="block font-semibold">Simuler une enveloppe de rémunération (facultatif)</span>
            <span className="block text-sm text-muted">Comparez, pour un même coût, une prime classique, l’intéressement, l’abondement, la prime de partage de la valeur et les titres-restaurant.</span></span>
        </label>
        {sim.enabled && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Enveloppe par salarié (coût employeur)" htmlFor="sim-env"><NumberInput id="sim-env" min={0} max={100000} suffix="€" value={sim.envelopePerEmployee} onChange={(n) => setSim({ envelopePerEmployee: n })} /></Field>
            <Field label="Nombre de salariés concernés" htmlFor="sim-n"><NumberInput id="sim-n" integer min={1} max={5000} value={sim.employeeCount} onChange={(n) => setSim({ employeeCount: n })} /></Field>
            <Field label="Salaire brut annuel moyen" htmlFor="sim-avg"><NumberInput id="sim-avg" min={0} suffix="€" value={sim.averageGross} onChange={(n) => setSim({ averageGross: n })} /></Field>
            <Field label="Taux marginal d’imposition moyen" htmlFor="sim-tmi" hint="Facultatif"><NumberInput id="sim-tmi" min={0} max={60} suffix="%" value={sim.tmiPct} onChange={(n) => setSim({ tmiPct: n })} /></Field>
            <Field label="Jours de repas par an" htmlFor="sim-days" hint="Pour les titres-restaurant, facultatif"><NumberInput id="sim-days" integer min={0} max={366} value={sim.mealDays} onChange={(n) => setSim({ mealDays: n })} /></Field>
          </div>
        )}
      </Card>
    </div>
  );
}

function RecapStep({ answers, meta, update, goTo, issues: serverIssues }: StepProps) {
  const local = submissionIssues(answers, meta).filter((i) => i.step !== 'recapitulatif');
  const issues = serverIssues.length ? serverIssues : local;
  const stepIndex = (id: StepId) => STEPS.findIndex((s) => s.id === id);
  const e = answers.entreprise;
  const lines: [StepId, string][] = [
    ['entreprise', `${e.company.legalName} · effectif ${meta.years.map((y) => `${y} : ${e.headcountByYear[String(y)] ?? '?'}`).join(', ')} · ${e.establishments.filter((x) => x.concerned).length} établissement(s)`],
    ['salaires', meta.years.map((y) => `${y} : ${Object.values(answers.salaires.years[String(y)]?.brackets ?? {}).reduce((a, b) => a + b.count, 0)} salarié(s) répartis`).join(' · ')],
    ['reduction', meta.years.map((y) => { const r = answers.reduction.years[String(y)]; return `${y} : ${r?.known && r.amount != null ? formatEur(r.amount) : 'inconnue'}`; }).join(' · ')],
    ['taux_at', `${answers.taux_at.rates.filter((r) => r.appliedRatePct != null).length} taux renseigné(s)`],
    ['alternance', `${answers.alternance.contracts.length} contrat(s)`],
    ['dispositifs', answers.dispositifs.simulation.enabled ? 'Simulation de rémunération demandée' : 'Sans simulation'],
  ];
  return (
    <div className="space-y-4">
      <Card className="divide-y divide-line p-0 sm:p-0">
        {lines.map(([id, text]) => (
          <div key={id} className="flex items-start justify-between gap-3 p-4">
            <div><p className="text-sm font-semibold">{STEPS[stepIndex(id)]!.title}</p><p className="mt-1 text-sm text-muted">{text}</p></div>
            <Button variant="link" onClick={() => goTo(stepIndex(id))}>Modifier</Button>
          </div>
        ))}
      </Card>
      {issues.length > 0 && (
        <Alert tone={issues.some((i) => i.blocking) ? 'danger' : 'warn'}>
          <ul className="list-disc space-y-1 pl-5">{issues.map((i) => <li key={i.message}>{i.message} {i.step !== 'recapitulatif' && <button type="button" className="underline" onClick={() => goTo(stepIndex(i.step))}>Corriger</button>}</li>)}</ul>
        </Alert>
      )}
      <Card>
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-1 size-5 accent-brand" checked={answers.recapitulatif.consent}
            onChange={(ev) => update('recapitulatif', { consent: ev.target.checked, consentTextVersion: CONSENT_TEXT_VERSION })} />
          <span className="text-sm">{CONSENT_TEXT} <a href="/confidentialite" target="_blank" className="text-brand underline">Politique de confidentialité</a></span>
        </label>
      </Card>
    </div>
  );
}
