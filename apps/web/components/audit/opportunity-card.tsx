import type { Opportunity } from '@recupfiscal/engine';
import { Badge, Card } from '@/components/ui/card';
import { formatEur } from '@/lib/questionnaire';

const STATUS: Record<Opportunity['status'], { label: string; tone: 'good' | 'warn' | 'info' | 'neutral' | 'danger' }> = {
  estime: { label: 'Estimé', tone: 'good' },
  a_confirmer: { label: 'À confirmer', tone: 'warn' },
  informations_manquantes: { label: 'Informations manquantes', tone: 'info' },
  parametre_manquant: { label: 'Paramètres en cours de validation', tone: 'neutral' },
  non_reclamable: { label: 'Non réclamable', tone: 'neutral' },
  aucun_ecart: { label: 'Aucun écart', tone: 'neutral' },
};
const CONF = { eleve: 'élevée', moyen: 'moyenne', faible: 'faible' } as const;
const RISK = { faible: 'faible', standard: 'standard', eleve: 'élevé' } as const;

export function OpportunityCard({ o }: { o: Opportunity }) {
  const s = STATUS[o.status];
  const years = o.periodFrom.slice(0, 4) === o.periodTo.slice(0, 4) ? o.periodFrom.slice(0, 4) : `${o.periodFrom.slice(0, 4)}-${o.periodTo.slice(0, 4)}`;
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{o.name}</h3>
          <p className="text-sm text-muted">{o.kind === 'recuperation_passee' ? 'Récupération passée' : 'Économie future'} · {years}</p>
        </div>
        <Badge tone={s.tone}>{s.label}</Badge>
      </div>
      {o.amounts && (
        <p className="text-lg font-bold text-money tabular">
          {o.amounts.low === o.amounts.high ? formatEur(o.amounts.central) : `${formatEur(o.amounts.low)} à ${formatEur(o.amounts.high)}`}
          {!o.countsInTotals && <span className="ml-2 text-xs font-normal text-muted">(simulation, non additionnée)</span>}
        </p>
      )}
      <p className="text-sm">{o.explanation}</p>
      <p className="text-xs text-muted">Confiance {CONF[o.confidence]} · risque {RISK[o.risk]}</p>
      {o.conditionsDetected.length > 0 && (
        <details className="text-sm"><summary className="cursor-pointer font-medium">Conditions</summary><ul className="mt-2 list-disc space-y-1 pl-5 text-muted">{o.conditionsDetected.map((c) => <li key={c}>{c}</li>)}</ul></details>
      )}
      {o.missingInformation.length > 0 && (
        <details className="text-sm"><summary className="cursor-pointer font-medium">Informations manquantes</summary><ul className="mt-2 list-disc space-y-1 pl-5 text-muted">{o.missingInformation.map((c) => <li key={c}>{c}</li>)}</ul></details>
      )}
      {o.documentsToProvide.length > 0 && (
        <details className="text-sm"><summary className="cursor-pointer font-medium">Documents à fournir</summary><ul className="mt-2 list-disc space-y-1 pl-5 text-muted">{o.documentsToProvide.map((c) => <li key={c}>{c}</li>)}</ul></details>
      )}
    </Card>
  );
}
