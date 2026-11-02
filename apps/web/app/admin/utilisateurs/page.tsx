import { ActionForm, inputCls } from '@/components/admin/action-form';
import { Card } from '@/components/ui/card';
import { setInternalRoleAction } from '@/app/admin/actions';
import { auditLog, listInternalUsers } from '@/lib/admin-service';
import { adminUser } from '@/lib/server/admin-guard';
import { getDb } from '@/lib/db';

export default async function Equipe() {
  const user = await adminUser('administrateur');
  const db = await getDb();
  const [users, log] = await Promise.all([listInternalUsers(db, user.id), auditLog(db, user.id, 60)]);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Équipe interne</h1>
      <Card className="space-y-3">
        <ul className="text-sm">{users.map((u) => <li key={u.id}>{u.email} · {u.internal_role}</li>)}</ul>
        <ActionForm action={setInternalRoleAction} className="flex flex-wrap gap-2 text-sm">
          <input name="email" type="email" required placeholder="adresse@…" className={`${inputCls} w-64`} aria-label="Adresse e-mail" />
          <select name="role" className={`${inputCls} w-auto`} aria-label="Rôle"><option value="analyste">Analyste</option><option value="administrateur">Administrateur</option><option value="aucun">Retirer le rôle</option></select>
          <button className="rounded-lg bg-brand px-3 py-1.5 font-semibold text-white">Appliquer</button>
        </ActionForm>
        <p className="text-xs text-muted">La personne doit s’être connectée au moins une fois. Le premier administrateur est créé en ligne de commande (admin:grant).</p>
      </Card>
      <Card>
        <h2 className="font-semibold">Journal des actions sensibles</h2>
        <ul className="mt-2 max-h-96 overflow-y-auto text-xs tabular">{log.map((l) => <li key={l.id}>{l.created_at.slice(0, 19)} · {l.actor_email ?? 'système'} · {l.action} · {l.table_name} · {l.row_id ?? ''}</li>)}</ul>
      </Card>
    </div>
  );
}
