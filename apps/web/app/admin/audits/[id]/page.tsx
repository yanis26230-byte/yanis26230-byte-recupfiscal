import { notFound } from 'next/navigation';
import { ActionForm, inputCls } from '@/components/admin/action-form';
import { Badge, Card } from '@/components/ui/card';
import { reviewOpportunityAction } from '@/app/admin/actions';
import { NotFound } from '@/lib/account-service';
import { auditForReview } from '@/lib/admin-service';
import { adminUser } from '@/lib/server/admin-guard';
import { getDb } from '@/lib/db';
import { formatEur } from '@/lib/questionnaire';

export default async function AdminAudit({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await adminUser();
  let data;
  try { data = await auditForReview(await getDb(), user.id, id); } catch (e) { if (e instanceof NotFound) notFound(); throw e; }
  const { audit, opportunities, documents } = data;
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{audit.company_name ?? 'Audit'} {audit.is_demo && <Badge tone="warn">Démo</Badge>}</h1>
      <p className="text-sm text-muted">Audit {audit.mode} · {audit.status} · créé le {new Date(audit.created_at).toLocaleDateString('fr-FR')} · calcul {audit.run_id ?? '—'}</p>
      <Card className="space-y-3">
        <h2 className="font-semibold">Opportunités : revue analyste</h2>
        <p className="text-xs text-muted">Le montant validé est distinct de l’estimation du moteur (immuable) et du montant réellement remboursé.</p>
        <ul className="divide-y divide-line" data-testid="review-list">
          {opportunities.map((o) => (
            <li key={o.id} className="grid gap-3 py-3 sm:grid-cols-2">
              <div>
                <p className="font-medium">{o.name} · {o.year}</p>
                <p className="text-sm text-muted">{o.status} · {o.estimated_high !== null ? `${formatEur(o.estimated_low ?? 0)} – ${formatEur(o.estimated_high)}` : 'sans montant'} · confiance {o.confidence} · risque {o.risk}</p>
                <p className="text-sm">Revue : <Badge tone={o.review_status === 'valide' ? 'good' : o.review_status === 'rejete' ? 'danger' : 'neutral'}>{o.review_status}</Badge>{o.validated_amount !== null && ` ${formatEur(o.validated_amount)}`} {o.review_comment && <span className="text-muted">— {o.review_comment}</span>}</p>
              </div>
              <ActionForm action={reviewOpportunityAction.bind(null, id, o.id)} className="text-sm">
                <div className="flex gap-2">
                  <select name="decision" className={inputCls} defaultValue="valide" aria-label="Décision"><option value="valide">Valider</option><option value="rejete">Rejeter</option></select>
                  <input name="amount" className={inputCls} placeholder="Montant validé (€)" aria-label="Montant validé" />
                </div>
                <input name="comment" className={inputCls} placeholder="Commentaire interne / motif" aria-label="Commentaire" />
                <button className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white">Enregistrer la revue</button>
              </ActionForm>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h2 className="font-semibold">Documents de l’entreprise</h2>
        {documents.length === 0 ? <p className="text-sm text-muted">Aucun.</p> : <ul className="text-sm">{documents.map((d) => <li key={d.id}>{d.original_filename} · {d.document_type ?? '—'} · {d.status} · {d.pending} à valider</li>)}</ul>}
      </Card>
    </div>
  );
}
