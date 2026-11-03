import { ActionButton, ActionForm, inputCls } from '@/components/admin/action-form';
import { Badge, Card } from '@/components/ui/card';
import { createParameterAction, fillParameterAction, importParametersAction, parameterStatusAction } from '@/app/admin/actions';
import { listParameters, missingParameters } from '@/lib/admin-service';
import { adminUser } from '@/lib/server/admin-guard';
import { getDb } from '@/lib/db';

const TONE: Record<string, 'neutral' | 'warn' | 'info' | 'good' | 'danger'> = { a_renseigner: 'warn', brouillon: 'neutral', valide: 'info', publie: 'good', archive: 'neutral' };

export default async function Parametres({ searchParams }: { searchParams: Promise<{ statut?: string; cle?: string }> }) {
  const sp = await searchParams;
  const user = await adminUser('administrateur');
  const db = await getDb();
  const [params, missing] = await Promise.all([listParameters(db, user.id, { status: sp.statut || undefined, key: sp.cle || undefined }), missingParameters(db, user.id)]);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Paramètres réglementaires (jeu officiel)</h1>
      <Card className="space-y-2">
        <h2 className="font-semibold">Règles à compléter</h2>
        <p className="text-xs text-muted">Paramètres absents ou non publiés ayant bloqué des calculs réels récents.</p>
        {missing.length === 0 ? <p className="text-sm text-muted">Aucune.</p> : (
          <ul className="max-h-64 overflow-y-auto text-sm" data-testid="missing">{missing.map((m) => <li key={`${m.key}${m.period_from}`}><a className="text-brand underline" href={`?cle=${m.key}`}>{m.key}</a> · {m.period_from} → {m.period_to} · {m.reason} · {m.runs} calcul(s)</li>)}</ul>
        )}
      </Card>
      <Card className="space-y-2">
        <h2 className="font-semibold">Saisie en lot</h2>
        <p className="text-sm text-muted">Téléchargez le <a className="text-brand underline" href="/admin/parametres/modele" data-testid="param-template">modèle des paramètres à renseigner</a> (CSV, séparateur « ; »), complétez les colonnes <em>valeur</em>, <em>source</em> (URL officielle en https) et <em>verifie_le</em>, puis importez-le. Chaque ligne devient un brouillon : la validation par un second administrateur reste obligatoire.</p>
        <ActionForm action={importParametersAction} className="flex flex-wrap items-center gap-2 text-sm">
          <input name="fichier" type="file" accept=".csv,text/csv" required className={`${inputCls} w-auto`} aria-label="Fichier CSV des paramètres" />
          <button className="rounded-lg bg-brand px-3 py-1.5 font-semibold text-white">Importer en brouillons</button>
        </ActionForm>
      </Card>
      <form className="flex flex-wrap gap-2 text-sm">
        <select name="statut" defaultValue={sp.statut ?? ''} className={`${inputCls} w-auto`} aria-label="Statut">
          <option value="">Tous les statuts</option>{['a_renseigner', 'brouillon', 'valide', 'publie', 'archive'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input name="cle" defaultValue={sp.cle ?? ''} placeholder="Clé exacte" className={`${inputCls} w-auto`} aria-label="Clé" />
        <button className="rounded-lg border border-line bg-white px-3">Filtrer</button>
      </form>
      <ul className="space-y-3" data-testid="parameters">
        {params.map((p) => (
          <li key={p.id}>
            <Card className="space-y-2 p-4 sm:p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-mono text-sm font-semibold">{p.key} <span className="font-sans font-normal text-muted">v{p.version}</span></p>
                <Badge tone={TONE[p.status]}>{p.status}</Badge>
              </div>
              <p className="text-sm">{p.label} · {p.valid_from} → {p.valid_to ?? '…'} · {p.territory}{p.module_id ? ` · ${p.module_id}` : ''}</p>
              <p className="text-sm">Valeur : <strong>{p.value ?? '—'}</strong> {p.unit} · source : {p.source_url ? <a className="text-brand underline" href={p.source_url} target="_blank" rel="noreferrer">{p.source_url}</a> : '—'} · vérifiée le {p.verified_at ?? '—'}</p>
              <p className="text-xs text-muted">Auteur : {p.author_email ?? '—'} · validateur : {p.validator_email ?? '—'}{p.note ? ` · ${p.note}` : ''}</p>
              <div className="flex flex-wrap gap-2">
                {p.status === 'brouillon' && <ActionButton label="Valider (second administrateur)" action={parameterStatusAction.bind(null, p.id, 'valider')} />}
                {p.status === 'valide' && <ActionButton label="Publier" action={parameterStatusAction.bind(null, p.id, 'publier')} confirmText="Publier ce paramètre ? Les cas de référence seront relancés." />}
                {p.status === 'valide' && <ActionButton label="Renvoyer en brouillon" variant="secondary" action={parameterStatusAction.bind(null, p.id, 'brouillon')} />}
              </div>
              {(p.status === 'a_renseigner' || p.status === 'publie') && (
                <details className="text-sm"><summary className="cursor-pointer text-brand">{p.status === 'publie' ? 'Créer une nouvelle version' : 'Renseigner (nouvelle version brouillon)'}</summary>
                  <ActionForm action={fillParameterAction.bind(null, p.id)} className="mt-2 grid gap-2 sm:grid-cols-4">
                    <input name="value" required placeholder="Valeur" className={inputCls} aria-label="Valeur" />
                    <input name="sourceUrl" required placeholder="https://… (source officielle)" className={inputCls} aria-label="Source" />
                    <input name="verifiedAt" required type="date" className={inputCls} aria-label="Date de vérification" />
                    <input name="note" placeholder="Note" className={inputCls} aria-label="Note" />
                    <button className="rounded-lg bg-brand px-3 py-1.5 font-semibold text-white">Créer le brouillon</button>
                  </ActionForm>
                </details>
              )}
            </Card>
          </li>
        ))}
      </ul>
      <Card className="space-y-2">
        <h2 className="font-semibold">Nouveau paramètre</h2>
        <ActionForm action={createParameterAction} className="grid gap-2 text-sm sm:grid-cols-3">
          <input name="key" required placeholder="cle_du_parametre" className={inputCls} aria-label="Clé" />
          <input name="label" required placeholder="Libellé" className={inputCls} aria-label="Libellé" />
          <input name="value" required placeholder="Valeur" className={inputCls} aria-label="Valeur" />
          <input name="unit" required placeholder="Unité" className={inputCls} aria-label="Unité" />
          <input name="validFrom" required type="date" className={inputCls} aria-label="Début" />
          <input name="validTo" type="date" className={inputCls} aria-label="Fin" />
          <input name="moduleId" placeholder="Module (facultatif)" className={inputCls} aria-label="Module" />
          <input name="sourceUrl" required placeholder="https://…" className={inputCls} aria-label="Source" />
          <input name="verifiedAt" required type="date" className={inputCls} aria-label="Vérifié le" />
          <button className="rounded-lg bg-brand px-3 py-1.5 font-semibold text-white">Créer en brouillon</button>
        </ActionForm>
      </Card>
    </div>
  );
}
