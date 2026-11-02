'use client';

import * as React from 'react';
import { decideFieldsAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Alert, Badge } from '@/components/ui/card';
import { NumberInput } from '@/components/ui/field';
import type { FieldRow } from '@/lib/documents/service';
import type { AtRateFieldValue, PayrollFieldValue } from '@/lib/documents/types';
import { formatEur } from '@/lib/questionnaire';

const STATUS: Record<string, { label: string; tone: 'warn' | 'good' | 'info' | 'danger' }> = {
  a_valider: { label: 'À valider', tone: 'warn' }, valide: { label: 'Validé', tone: 'good' }, corrige: { label: 'Corrigé', tone: 'info' }, rejete: { label: 'Rejeté', tone: 'danger' },
};

function source(f: FieldRow) {
  if (f.page) return `page ${f.page}`;
  if (f.zone && 'ligne' in f.zone) return `ligne ${f.zone.ligne}`;
  if (f.zone && 'salarie' in f.zone) return `salarié n°${f.zone.salarie}`;
  return '—';
}

export function FieldsReview({ path, fields, canWrite }: { path: string; fields: FieldRow[]; canWrite: boolean }) {
  const [editing, setEditing] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<Record<string, number | null>>({});
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = React.useTransition();
  const pendingIds = fields.filter((f) => f.status === 'a_valider').map((f) => f.id);
  const run = (decisions: Parameters<typeof decideFieldsAction>[1]) => start(async () => {
    const r = await decideFieldsAction(path, decisions);
    setMsg({ ok: r.ok, text: r.ok ? (r.message ?? 'Enregistré.') : r.message });
    setEditing(null);
  });

  return (
    <div className="space-y-3">
      {!canWrite && <Alert tone="info">Votre rôle permet de consulter ces valeurs, pas de les valider.</Alert>}
      {canWrite && pendingIds.length > 1 && (
        <Button variant="secondary" disabled={pending} onClick={() => { if (confirm(`Valider les ${pendingIds.length} valeurs en attente telles qu’elles ont été lues ?`)) run(pendingIds.map((fieldId) => ({ fieldId, action: 'valider' as const }))); }}>
          Valider les {pendingIds.length} valeurs en attente
        </Button>
      )}
      {msg && <Alert tone={msg.ok ? 'good' : 'danger'} data-testid="review-state">{msg.text}</Alert>}
      <ul className="space-y-3" data-testid="fields">
        {fields.map((f) => {
          const v = (f.corrected_value ?? f.value) as PayrollFieldValue & AtRateFieldValue;
          const isPay = f.field_key === 'ligne_paie';
          return (
            <li key={f.id} className="rounded-2xl border border-line bg-white p-4" data-testid="field-row">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{isPay ? `${v.employeeRef} · ${String(v.month).padStart(2, '0')}/${v.year}` : `Taux AT notifié ${v.year}`}</p>
                <Badge tone={STATUS[f.status]!.tone}>{STATUS[f.status]!.label}</Badge>
              </div>
              {editing === f.id ? (
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {(isPay ? [['gross', 'Brut (€)'], ['hoursPaid', 'Heures'], ['overtimeHours', 'Heures sup.'], ['reductionApplied', 'Réduction (€)']] : [['ratePct', 'Taux (%)']]).map(([k, label]) => (
                    <label key={k} className="text-sm">{label}
                      <NumberInput id={`${f.id}-${k}`} min={0} value={draft[k!] ?? null} onChange={(n) => setDraft((d) => ({ ...d, [k!]: n }))} />
                    </label>
                  ))}
                  <div className="col-span-full flex gap-2">
                    <Button size="sm" disabled={pending} onClick={() => run([{ fieldId: f.id, action: 'corriger', value: isPay
                      ? { ...v, gross: draft.gross ?? 0, hoursPaid: draft.hoursPaid ?? 0, overtimeHours: draft.overtimeHours ?? 0, reductionApplied: draft.reductionApplied ?? 0 }
                      : { siret: v.siret, year: v.year, rate: (draft.ratePct ?? 0) / 100 } }])}>Enregistrer la correction</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Annuler</Button>
                  </div>
                </div>
              ) : (
                <p className="mt-1 text-sm tabular">{isPay ? `Brut ${formatEur(v.gross, 2)} · ${v.hoursPaid} h · ${v.overtimeHours} h sup. · réduction ${formatEur(v.reductionApplied, 2)}` : `${(v.rate * 100).toFixed(2).replace('.', ',')} %${v.siret ? ` · SIRET ${v.siret}` : ''}`}</p>
              )}
              <p className="mt-1 text-xs text-muted">Source : {source(f)} · confiance {Math.round(f.confidence * 100)} % · {f.extractor}{f.corrected_value ? ' · valeur corrigée (valeur lue conservée)' : ''}</p>
              {canWrite && editing !== f.id && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {f.status === 'a_valider' && <Button size="sm" disabled={pending} onClick={() => run([{ fieldId: f.id, action: 'valider' }])}>Valider</Button>}
                  <Button size="sm" variant="secondary" disabled={pending} onClick={() => { setDraft(isPay ? { gross: v.gross, hoursPaid: v.hoursPaid, overtimeHours: v.overtimeHours, reductionApplied: v.reductionApplied } : { ratePct: Math.round(v.rate * 10000) / 100 }); setEditing(f.id); }}>Corriger</Button>
                  {f.status !== 'rejete' && <Button size="sm" variant="ghost" disabled={pending} onClick={() => run([{ fieldId: f.id, action: 'rejeter' }])}>Rejeter</Button>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
