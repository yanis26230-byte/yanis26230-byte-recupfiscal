'use client';

import { usePathname, useRouter } from 'next/navigation';
import * as React from 'react';
import { saveStepAction, submitAuditAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Alert, Progress } from '@/components/ui/card';
import { STEPS, type AuditMeta, type Issue, type StepAnswers } from '@/lib/questionnaire';
import { helpFor, type StepId } from '@/lib/sectors';
import { StepView } from './steps';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function Questionnaire({ auditId, initial, meta, annualSmic, initialStep, advanced = null }: {
  auditId: string; initial: StepAnswers; meta: AuditMeta; annualSmic: Record<string, number | null>; initialStep: number;
  advanced?: { lines: number; pending: number } | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [answers, setAnswers] = React.useState(initial);
  const [index, setIndex] = React.useState(initialStep);
  const [save, setSave] = React.useState<SaveState>('idle');
  // true tant que des modifications ne sont pas confirmées par le serveur.
  const [dirty, setDirty] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => setReady(true), []);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [issues, setIssues] = React.useState<Issue[]>([]);
  const pending = React.useRef<Map<StepId, unknown>>(new Map());
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const step = STEPS[index]!;
  const sector = answers.entreprise.company.sector;
  const help = helpFor(step.id, sector);

  const flush = React.useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const entries = [...pending.current.entries()];
    pending.current.clear();
    if (!entries.length) return true;
    setSave('saving');
    for (const [s, v] of entries) {
      const r = await saveStepAction(auditId, s, v);
      if (!r.ok) { setSave('error'); setSaveError(r.message); return false; }
    }
    setSave('saved');
    setSaveError(null);
    setDirty(pending.current.size > 0);
    return true;
  }, [auditId]);

  const update = <K extends StepId>(id: K, value: StepAnswers[K]) => {
    setAnswers((a) => ({ ...a, [id]: value }));
    pending.current.set(id, value);
    setDirty(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 700);
  };

  React.useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => { if (pending.current.size) { void flush(); e.preventDefault(); } };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [flush]);

  const goTo = async (i: number) => {
    await flush();
    setIndex(i);
    router.replace(`${pathname}?etape=${i + 1}`, { scroll: false });
    window.scrollTo({ top: 0 });
    requestAnimationFrame(() => headingRef.current?.focus());
  };

  const submit = async () => {
    setSubmitting(true);
    setIssues([]);
    if (!(await flush())) { setSubmitting(false); return; }
    const r = await submitAuditAction(auditId);
    // En cas de succès, l'action redirige vers la page de résultats.
    if (r && !r.ok) { setIssues(r.issues ?? [{ step: 'recapitulatif', message: r.message, blocking: true }]); setSubmitting(false); }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:py-10" data-testid="questionnaire" data-ready={ready ? 'true' : 'false'}>
      {advanced && (
        <Alert tone="info" className="mb-4" data-testid="advanced-info">
          Analyse avancée : {advanced.lines} mois de paie validés seront utilisés pour un calcul salarié par salarié.
          {advanced.pending > 0 && ` ${advanced.pending} valeur(s) lue(s) dans vos documents restent à valider et ne seront pas utilisées.`}
        </Alert>
      )}
      {meta.isDemo && <Alert tone="warn" className="mb-4">Démonstration : entreprise et paramètres <strong>fictifs</strong>. Les réponses sont pré-remplies.</Alert>}
      <div className="flex items-center justify-between text-sm text-muted">
        <span>Étape {index + 1} sur {STEPS.length} · {step.short}</span>
        <span aria-live="polite" data-testid="save-state" data-dirty={dirty ? 'true' : 'false'}>
          {save === 'saving' && 'Enregistrement…'}
          {save === 'saved' && 'Réponses enregistrées'}
          {save === 'error' && <span className="text-danger">Non enregistré</span>}
        </span>
      </div>
      <div className="mt-2"><Progress value={((index + 1) / STEPS.length) * 100} label="Progression du questionnaire" /></div>
      <h1 ref={headingRef} tabIndex={-1} className="mt-6 text-2xl font-bold outline-none sm:text-3xl">{step.title}</h1>

      <details className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm" open={index === 0}>
        <summary className="cursor-pointer font-medium text-brand-dark">Aide pour cette étape</summary>
        <p className="mt-2 text-navy">{help.common}</p>
        {help.sector && <p className="mt-2 text-navy">{help.sector}</p>}
      </details>

      {saveError && <Alert tone="danger" className="mt-4">{saveError}</Alert>}

      <div className="mt-6">
        <StepView step={step.id} answers={answers} meta={meta} annualSmic={annualSmic} update={update} goTo={goTo} issues={issues} />
      </div>

      <nav className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between" aria-label="Navigation du questionnaire">
        <Button variant="secondary" onClick={() => goTo(index - 1)} disabled={index === 0}>Précédent</Button>
        {index < STEPS.length - 1
          ? <Button onClick={() => goTo(index + 1)}>Suivant</Button>
          : <Button size="lg" onClick={submit} disabled={submitting || !answers.recapitulatif.consent}>{submitting ? 'Calcul en cours…' : 'Calculer mon estimation'}</Button>}
      </nav>
    </div>
  );
}
