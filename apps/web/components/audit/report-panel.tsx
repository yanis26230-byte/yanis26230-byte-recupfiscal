'use client';

import * as React from 'react';
import { generateReportAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';

export function ReportPanel({ auditId, reports }: { auditId: string; reports: { id: string; created_at: string; size_bytes: number }[] }) {
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [list, setList] = React.useState(reports);
  return (
    <Card className="space-y-3">
      <h2 className="text-lg font-semibold">Rapport PDF</h2>
      <p className="text-sm text-muted">Le rapport reprend vos données, chaque opportunité avec son calcul, les hypothèses, les paramètres et leurs sources, et l’identifiant du calcul. Il est conservé dans votre espace.</p>
      {list.length > 0 ? (
        <ul className="space-y-2">
          {list.map((r) => (
            <li key={r.id}><a className="font-medium text-brand underline" href={`/rapports/${r.id}`} data-testid="report-link">Télécharger le rapport du {new Date(r.created_at).toLocaleDateString('fr-FR')}</a> <span className="text-xs text-muted">({Math.round(r.size_bytes / 1024)} Ko)</span></li>
          ))}
        </ul>
      ) : (
        <Button disabled={pending} onClick={() => start(async () => {
          setError(null);
          const r = await generateReportAction(auditId);
          if (r.ok) setList([{ id: r.reportId, created_at: new Date().toISOString(), size_bytes: 0 }]); else setError(r.message);
        })}>{pending ? 'Génération…' : 'Générer le rapport PDF'}</Button>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
    </Card>
  );
}
