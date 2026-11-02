import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionButton, ActionForm, inputCls } from '@/components/admin/action-form';
import { Badge, Card } from '@/components/ui/card';
import { caseNoteAction, caseStatusAction, commissionStatusAction, recordRecoveryAction, verifyCompanyAction } from '@/app/admin/actions';
import { NotFound } from '@/lib/account-service';
import { adminUser } from '@/lib/server/admin-guard';
import { CASE_STATUS_LABELS, caseForAdmin } from '@/lib/case-service';
import { getDb } from '@/lib/db';
import { formatEur } from '@/lib/questionnaire';

export default async function AdminCase({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await adminUser();
  let d;
  try { d = await caseForAdmin(await getDb(), user.id, id); } catch (e) { if (e instanceof NotFound) notFound(); throw e; }
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{d.case.company_name} <Badge tone="info">{CASE_STATUS_LABELS[d.case.status]}</Badge></h1>
      <p className="text-sm text-muted">Mandat : {d.mandate ? `${d.mandate.status} · ${d.mandate.commission_rate * 100} % · ${d.mandate.terms_version} · ${d.mandate.provider}` : 'aucun'}{d.case.audit_id && <> · <Link className="text-brand underline" href={`/admin/audits/${d.case.audit_id}`}>revue des opportunités</Link></>}</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-3">
          <h2 className="font-semibold">Vérification de l’entreprise <Badge tone={d.case.verification_status === 'verifiee' ? 'good' : 'warn'}>{d.case.verification_status}</Badge></h2>
          <div className="flex gap-2"><ActionButton label="Marquer vérifiée" action={verifyCompanyAction.bind(null, id, d.case.company_id, 'verifiee')} /><ActionButton variant="secondary" label="Rejeter" action={verifyCompanyAction.bind(null, id, d.case.company_id, 'rejetee')} /></div>
          <h2 className="pt-2 font-semibold">Changer le statut</h2>
          <ActionForm action={caseStatusAction.bind(null, id)} className="text-sm">
            <select name="status" className={inputCls} aria-label="Nouveau statut">{Object.entries(CASE_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <input name="message" className={inputCls} placeholder="Message au client (facultatif)" aria-label="Message" />
            <button className="rounded-lg bg-brand px-3 py-1.5 font-semibold text-white">Appliquer</button>
          </ActionForm>
          <h2 className="pt-2 font-semibold">Note ou demande de pièce</h2>
          <ActionForm action={caseNoteAction.bind(null, id)} className="text-sm">
            <select name="kind" className={inputCls} aria-label="Type"><option value="commentaire_interne">Commentaire interne</option><option value="demande_piece">Demande de pièce (visible du client)</option></select>
            <textarea name="message" required rows={3} className={inputCls} aria-label="Texte" />
            <button className="rounded-lg bg-brand px-3 py-1.5 font-semibold text-white">Ajouter</button>
          </ActionForm>
        </Card>
        <Card className="space-y-3">
          <h2 className="font-semibold">Remboursement réellement encaissé</h2>
          <ActionForm action={recordRecoveryAction.bind(null, id)} className="text-sm" confirmText="Confirmer l’enregistrement de ce remboursement réel ? La commission sera calculée.">
            <input name="amount" required className={inputCls} placeholder="Montant remboursé (€)" aria-label="Montant remboursé" />
            <input name="receivedOn" required type="date" className={inputCls} aria-label="Date d’encaissement" />
            <select name="proof" required className={inputCls} aria-label="Justificatif"><option value="">Justificatif…</option>{d.companyDocuments.map((doc) => <option key={doc.id} value={doc.id}>{doc.original_filename}</option>)}</select>
            <select name="opportunity" className={inputCls} aria-label="Opportunité"><option value="">Opportunité (facultatif)</option>{d.opportunities.map((o) => <option key={o.id} value={o.id}>{o.name} {o.year}</option>)}</select>
            <button className="rounded-lg bg-brand px-3 py-1.5 font-semibold text-white">Enregistrer (administrateur)</button>
          </ActionForm>
          <h2 className="pt-2 font-semibold">Remboursements et commissions</h2>
          <ul className="text-sm tabular">{d.recoveries.map((r) => {
            const k = d.commissions.find((c) => c.recovery_id === r.id);
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-2 py-1">{r.received_on} : {formatEur(r.amount_reimbursed, 2)} · commission {k ? `${formatEur(k.amount, 2)} (${k.rate * 100} %, ${k.status})` : '—'}
                {k?.status === 'facturable' && <ActionButton label="Facturée" variant="secondary" action={commissionStatusAction.bind(null, id, k.id, 'facturee')} />}
                {k?.status === 'facturee' && <ActionButton label="Payée" variant="secondary" action={commissionStatusAction.bind(null, id, k.id, 'payee')} />}
              </li>
            );
          })}</ul>
        </Card>
      </div>
      <Card>
        <h2 className="font-semibold">Chronologie (interne incluse)</h2>
        <ol className="mt-2 space-y-1 text-sm">{d.events.map((e) => <li key={e.id}><span className="text-muted">{new Date(e.created_at).toLocaleString('fr-FR')}</span> · {e.event_type === 'changement_statut' ? `statut → ${e.to_status}` : e.message} {e.internal_only && <Badge>interne</Badge>}</li>)}</ol>
      </Card>
      <Card>
        <h2 className="font-semibold">Documents du dossier</h2>
        <ul className="text-sm">{d.documents.map((doc) => <li key={doc.id}><a className="text-brand underline" href={`/documents/${doc.id}`}>{doc.original_filename}</a> · {doc.document_type ?? '—'}</li>)}</ul>
      </Card>
    </div>
  );
}
