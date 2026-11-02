import { Card } from '@/components/ui/card';
import { indicators } from '@/lib/admin-service';
import { adminUser } from '@/lib/server/admin-guard';
import { getDb } from '@/lib/db';
import { formatEur } from '@/lib/questionnaire';
import { SECTOR_LABELS, type SectorId } from '@/lib/sectors';

export default async function AdminHome() {
  const user = await adminUser();
  const i = await indicators(await getDb(), user.id);
  const tiles: [string, string][] = [
    ['Prospects', String(i.leads)], ['Comptes clients', String(i.accounts)], ['Audits rapides', String(i.quickAudits)], ['Audits avancés', String(i.advancedAudits)],
    ['Mandats signés', String(i.mandatesSigned)], ['Montant estimé (central)', formatEur(i.estimatedCentral)], ['Montant confirmé', formatEur(i.confirmed)],
    ['Montant récupéré', formatEur(i.recovered)], ['Commissions facturables', formatEur(i.commissionsBillable)], ['Commissions payées', formatEur(i.commissionsPaid)],
  ];
  const pct = (x: number | null) => (x === null ? '—' : `${x} %`);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Indicateurs</h1>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5" data-testid="indicators">
        {tiles.map(([k, v]) => <Card key={k} className="p-4 sm:p-4"><p className="text-xs text-muted">{k}</p><p className="mt-1 text-xl font-bold tabular">{v}</p></Card>)}
      </div>
      <Card>
        <h2 className="font-semibold">Conversion</h2>
        <ul className="mt-2 text-sm">
          <li>Audits calculés → prospects : {pct(i.conversion.auditToLead)}</li>
          <li>Prospects → comptes : {pct(i.conversion.leadToAccount)}</li>
          <li>Comptes → mandats signés : {pct(i.conversion.accountToMandate)}</li>
        </ul>
      </Card>
      <Card>
        <h2 className="font-semibold">Répartition par secteur</h2>
        <ul className="mt-2 text-sm">{i.bySector.map((s) => <li key={s.sector}>{SECTOR_LABELS[s.sector as SectorId] ?? s.sector} : {s.audits}</li>)}</ul>
      </Card>
    </div>
  );
}
