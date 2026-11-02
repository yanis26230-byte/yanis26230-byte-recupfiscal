import { ActionButton, ActionForm, inputCls } from '@/components/admin/action-form';
import { Badge, Card } from '@/components/ui/card';
import { createZoneSchemeAction, importZoningAction, referenceStatusAction } from '@/app/admin/actions';
import { listZoning } from '@/lib/admin-service';
import { adminUser } from '@/lib/server/admin-guard';
import { getDb } from '@/lib/db';

function Actions({ table, id, status }: { table: 'zoning_datasets' | 'zone_schemes'; id: string; status: string }) {
  return (
    <span className="flex flex-wrap gap-2">
      {(status === 'brouillon' || status === 'a_renseigner') && <ActionButton label="Valider (second administrateur)" action={referenceStatusAction.bind(null, table, id, 'valide')} />}
      {status === 'valide' && <ActionButton label="Publier" action={referenceStatusAction.bind(null, table, id, 'publie')} />}
      {status === 'publie' && <ActionButton variant="secondary" label="Archiver" action={referenceStatusAction.bind(null, table, id, 'archive')} confirmText="Archiver ?" />}
    </span>
  );
}

export default async function Zonages() {
  const user = await adminUser('administrateur');
  const z = await listZoning(await getDb(), user.id);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Zonages et dispositifs zonaux</h1>
      <Card className="space-y-2">
        <h2 className="font-semibold">Tables de zonage</h2>
        {z.datasets.length === 0 && <p className="text-sm text-muted">Aucune table importée : le module zonages ne peut conclure pour aucune commune.</p>}
        <ul className="divide-y divide-line text-sm">{z.datasets.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span><strong>{d.zone_type}</strong> v{d.version} · {d.valid_from} → {d.valid_to ?? '…'} · {d.communes} commune(s) · <a className="text-brand underline" href={d.source_url}>{d.source_label}</a> <Badge>{d.status}</Badge></span>
            <Actions table="zoning_datasets" id={d.id} status={d.status} />
          </li>))}
        </ul>
        <details><summary className="cursor-pointer text-sm text-brand">Importer une table (CSV « code_insee;commune;debut;fin »)</summary>
          <ActionForm action={importZoningAction} className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
            <input name="zoneType" required placeholder="type (ex. frr)" className={inputCls} aria-label="Type de zone" />
            <input name="sourceLabel" required placeholder="Texte source (arrêté, décret…)" className={inputCls} aria-label="Libellé de la source" />
            <input name="sourceUrl" required placeholder="https://www.legifrance.gouv.fr/…" className={inputCls} aria-label="URL de la source" />
            <span className="flex gap-2"><input name="validFrom" required type="date" className={inputCls} aria-label="Début" /><input name="validTo" type="date" className={inputCls} aria-label="Fin" /></span>
            <textarea name="csv" required rows={6} className={`${inputCls} sm:col-span-2`} placeholder={'code_insee;commune\n26362;Valence'} aria-label="Communes (CSV)" />
            <button className="rounded-lg bg-brand px-3 py-1.5 font-semibold text-white">Importer en brouillon</button>
          </ActionForm>
        </details>
      </Card>
      <Card className="space-y-2">
        <h2 className="font-semibold">Dispositifs</h2>
        <ul className="divide-y divide-line text-sm">{z.schemes.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span><strong>{s.code}</strong> {s.name} · zone {s.zone_type} · dès le {s.valid_from} <Badge>{s.status}</Badge></span>
            <Actions table="zone_schemes" id={s.id} status={s.status} />
          </li>))}
        </ul>
        <details><summary className="cursor-pointer text-sm text-brand">Nouveau dispositif</summary>
          <ActionForm action={createZoneSchemeAction} className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
            <input name="zoneType" required placeholder="type de zone" className={inputCls} aria-label="Type de zone" />
            <input name="code" required placeholder="CODE_DISPOSITIF" className={inputCls} aria-label="Code" />
            <input name="name" required placeholder="Nom" className={inputCls} aria-label="Nom" />
            <input name="sourceUrl" required placeholder="https://…" className={inputCls} aria-label="Source" />
            <textarea name="description" required rows={2} placeholder="Description" className={`${inputCls} sm:col-span-2`} aria-label="Description" />
            <textarea name="conditions" rows={3} placeholder="Une condition par ligne" className={inputCls} aria-label="Conditions" />
            <textarea name="documents" rows={3} placeholder="Un justificatif par ligne" className={inputCls} aria-label="Justificatifs" />
            <span className="flex gap-2"><input name="validFrom" required type="date" className={inputCls} aria-label="Début" /><input name="validTo" type="date" className={inputCls} aria-label="Fin" /></span>
            <button className="rounded-lg bg-brand px-3 py-1.5 font-semibold text-white">Créer en brouillon</button>
          </ActionForm>
        </details>
      </Card>
    </div>
  );
}
