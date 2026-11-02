'use client';

import * as React from 'react';
import { saveManualPayrollAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { Field, NumberInput } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';

type Month = { month: number; gross: number | null; hoursPaid: number | null; overtimeHours: number | null; reductionApplied: number | null };
const MONTHS = ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.'];

export function PayrollEditor({ companyId, year, canWrite, establishments, employees }: {
  companyId: string; year: number; canWrite: boolean; establishments: { id: string; label: string }[];
  employees: { ref: string; contract: string; months: { month: number; gross: number; hours_paid: number; overtime_hours: number; reduction_applied: number }[] }[];
}) {
  const [ref, setRef] = React.useState(employees[0]?.ref ?? '');
  const [contract, setContract] = React.useState(employees[0]?.contract ?? 'CDI');
  const [establishmentId, setEstablishmentId] = React.useState<string>(establishments.length === 1 ? establishments[0]!.id : '');
  const load = (r: string): Month[] => {
    const e = employees.find((x) => x.ref === r);
    return MONTHS.map((_, i) => {
      const m = e?.months.find((x) => x.month === i + 1);
      return { month: i + 1, gross: m?.gross ?? null, hoursPaid: m?.hours_paid ?? null, overtimeHours: m?.overtime_hours ?? null, reductionApplied: m?.reduction_applied ?? null };
    });
  };
  const [months, setMonths] = React.useState<Month[]>(load(ref));
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = React.useTransition();
  const set = (i: number, k: keyof Month, v: number | null) => setMonths((ms) => ms.map((m, j) => (j === i ? { ...m, [k]: v } : m)));

  return (
    <Card className="space-y-4">
      <h2 className="text-lg font-semibold">Saisie mois par mois – {year}</h2>
      {employees.length > 0 && (
        <Field label="Salarié existant" htmlFor="emp-select">
          <Select id="emp-select" value={employees.some((e) => e.ref === ref) ? ref : ''} onChange={(e) => { setRef(e.target.value); setContract(employees.find((x) => x.ref === e.target.value)?.contract ?? 'CDI'); setMonths(load(e.target.value)); }}>
            <option value="">Nouveau salarié</option>
            {employees.map((e) => <option key={e.ref} value={e.ref}>{e.ref}</option>)}
          </Select>
        </Field>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Identifiant interne" htmlFor="emp-ref" hint="Ex. S001 — jamais de nom"><Input id="emp-ref" value={ref} maxLength={32} onChange={(e) => setRef(e.target.value)} disabled={!canWrite} /></Field>
        <Field label="Contrat" htmlFor="emp-contract"><Input id="emp-contract" value={contract} maxLength={40} onChange={(e) => setContract(e.target.value)} disabled={!canWrite} /></Field>
        <Field label="Établissement" htmlFor="emp-est">
          <Select id="emp-est" value={establishmentId} onChange={(e) => setEstablishmentId(e.target.value)} disabled={!canWrite}>
            <option value="">Non précisé</option>
            {establishments.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
          </Select>
        </Field>
      </div>
      <div className="space-y-2">
        {months.map((m, i) => (
          <fieldset key={m.month} className="grid grid-cols-2 gap-2 border-t border-line pt-2 sm:grid-cols-5 sm:items-end">
            <legend className="text-sm font-semibold sm:col-span-1">{MONTHS[i]}</legend>
            <label className="text-xs">Brut (€)<NumberInput id={`g-${i}`} ariaLabel={`Brut ${MONTHS[i]}`} min={0} value={m.gross} onChange={(v) => set(i, 'gross', v)} /></label>
            <label className="text-xs">Heures<NumberInput id={`h-${i}`} ariaLabel={`Heures ${MONTHS[i]}`} min={0} max={400} value={m.hoursPaid} onChange={(v) => set(i, 'hoursPaid', v)} /></label>
            <label className="text-xs">H. sup.<NumberInput id={`o-${i}`} ariaLabel={`Heures supplémentaires ${MONTHS[i]}`} min={0} max={400} value={m.overtimeHours} onChange={(v) => set(i, 'overtimeHours', v)} /></label>
            <label className="text-xs">Réduction (€)<NumberInput id={`r-${i}`} ariaLabel={`Réduction ${MONTHS[i]}`} min={0} value={m.reductionApplied} onChange={(v) => set(i, 'reductionApplied', v)} /></label>
          </fieldset>
        ))}
      </div>
      {canWrite ? (
        <Button disabled={pending} onClick={() => start(async () => {
          const filled = months.filter((m) => m.gross !== null && m.hoursPaid !== null)
            .map((m) => ({ month: m.month, gross: m.gross!, hoursPaid: m.hoursPaid!, overtimeHours: m.overtimeHours ?? 0, reductionApplied: m.reductionApplied ?? 0 }));
          const r = await saveManualPayrollAction(companyId, { employeeRef: ref.trim(), contractType: contract || null, establishmentId: establishmentId || null, year, months: filled });
          setMsg({ ok: r.ok, text: r.ok ? `${filled.length} mois enregistrés pour ${ref}.` : r.message });
        })}>{pending ? 'Enregistrement…' : 'Enregistrer'}</Button>
      ) : <Alert tone="info">Votre rôle permet la consultation uniquement.</Alert>}
      {msg && <Alert tone={msg.ok ? 'good' : 'danger'} data-testid="payroll-state">{msg.text}</Alert>}
    </Card>
  );
}
