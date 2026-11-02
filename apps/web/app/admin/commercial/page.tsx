import { ActionForm, inputCls } from '@/components/admin/action-form';
import { Badge, Card } from '@/components/ui/card';
import { publishTextAction, updateSettingsAction } from '@/app/admin/actions';
import { commercialSettings } from '@/lib/admin-service';
import { adminUser } from '@/lib/server/admin-guard';
import { getDb } from '@/lib/db';

export default async function Commercial() {
  const user = await adminUser('administrateur');
  const { settings, texts } = await commercialSettings(await getDb(), user.id);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Conditions commerciales</h1>
      <Card>
        <ActionForm action={updateSettingsAction} className="grid gap-3 text-sm sm:grid-cols-3">
          <label>Commission sur les récupérations (%)<input name="commissionRate" defaultValue={String(settings.commission_rate * 100).replace('.', ',')} className={inputCls} /></label>
          <label className="flex items-center gap-2 pt-5"><input type="checkbox" name="future" defaultChecked={settings.commission_on_future_savings} className="size-5" /> Commission sur les économies futures</label>
          <label>Taux sur les économies futures (%)<input name="futureRate" defaultValue={settings.future_savings_commission_rate === null ? '' : String(settings.future_savings_commission_rate * 100)} className={inputCls} /></label>
          <button className="rounded-lg bg-brand px-3 py-2 font-semibold text-white sm:col-span-3 sm:w-fit">Enregistrer</button>
        </ActionForm>
        <p className="mt-2 text-xs text-muted">La commission ne porte jamais sur une estimation : elle est calculée uniquement à l’enregistrement d’un remboursement réel justifié. Le taux appliqué est figé dans chaque mandat signé.</p>
      </Card>
      <Card className="space-y-3">
        <h2 className="font-semibold">Textes contractuels et e-mails automatiques</h2>
        <ul className="divide-y divide-line text-sm">{texts.map((t) => <li key={t.id} className="py-2"><strong>{t.key}</strong> v{t.version} · {t.title} {t.active && <Badge tone="good">actif</Badge>}<details><summary className="cursor-pointer text-xs text-brand">Voir</summary><p className="whitespace-pre-wrap text-xs">{t.body}</p></details></li>)}</ul>
        <ActionForm action={publishTextAction} className="grid gap-2 text-sm">
          <select name="key" className={inputCls} aria-label="Texte">
            <option value="conditions_mandat">Conditions du mandat</option><option value="email_statut_dossier">E-mail : changement de statut du dossier</option>
            <option value="email_invitation">E-mail : invitation</option><option value="email_lien_connexion">E-mail : lien de connexion</option>
          </select>
          <input name="title" required placeholder="Titre" className={inputCls} aria-label="Titre" />
          <textarea name="body" required rows={8} placeholder="Texte (à faire valider par un professionnel du droit)" className={inputCls} aria-label="Corps du texte" />
          <button className="w-fit rounded-lg bg-brand px-3 py-2 font-semibold text-white">Publier une nouvelle version</button>
        </ActionForm>
      </Card>
    </div>
  );
}
