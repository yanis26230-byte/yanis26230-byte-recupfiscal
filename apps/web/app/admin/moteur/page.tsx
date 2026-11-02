import { ActionButton } from '@/components/admin/action-form';
import { Badge, Card } from '@/components/ui/card';
import { runReferenceTestsAction, setModuleAction } from '@/app/admin/actions';
import { listModules, listReferenceCases } from '@/lib/admin-service';
import { adminUser } from '@/lib/server/admin-guard';
import { getDb } from '@/lib/db';

export default async function Moteur() {
  const user = await adminUser('administrateur');
  const db = await getDb();
  const [modules, cases] = await Promise.all([listModules(db, user.id), listReferenceCases(db, user.id)]);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Moteur de calcul</h1>
      <Card className="space-y-2">
        <h2 className="font-semibold">Modules</h2>
        <ul className="divide-y divide-line" data-testid="modules">
          {modules.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span><strong>{m.name}</strong> <span className="text-muted">{m.id} v{m.current_version} · {m.kind}</span></span>
              <span className="flex items-center gap-2"><Badge tone={m.enabled ? 'good' : 'neutral'}>{m.enabled ? 'actif' : 'désactivé'}</Badge>
                <ActionButton variant="secondary" label={m.enabled ? 'Désactiver' : 'Activer'} action={setModuleAction.bind(null, m.id, !m.enabled)} /></span>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="space-y-2">
        <div className="flex items-center justify-between"><h2 className="font-semibold">Cas de référence</h2><ActionButton label="Relancer tous les cas" action={runReferenceTestsAction} /></div>
        <ul className="divide-y divide-line text-sm" data-testid="reference-cases">
          {cases.map((c) => (
            <li key={c.code} className="py-2">
              <p><strong>{c.code}</strong> {c.name} {c.last_run_passed === null ? <Badge>jamais exécuté</Badge> : <Badge tone={c.last_run_passed ? 'good' : 'danger'}>{c.last_run_passed ? 'réussi' : 'échec'}</Badge>}</p>
              <p className="text-xs text-muted">{c.calculation}</p>
              {c.last_run_details && c.last_run_details.length > 0 && <p className="text-xs text-danger">{c.last_run_details.join(' ; ')}</p>}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
