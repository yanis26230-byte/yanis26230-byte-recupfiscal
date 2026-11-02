import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { UploadCaseDocument } from '@/components/cases/upload-case-document';
import { Alert, Badge, Card } from '@/components/ui/card';
import { NotFound } from '@/lib/account-service';
import { getCurrentUser } from '@/lib/auth';
import { CASE_STATUS_LABELS, caseForClient } from '@/lib/case-service';
import { getDb } from '@/lib/db';
import { formatEur } from '@/lib/questionnaire';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dossier', robots: { index: false } };

const MANDATE: Record<string, string> = { a_signer: 'À signer', envoye: 'Envoyé pour signature', signe: 'Signé', refuse: 'Signature refusée', expire: 'Expiré', annule: 'Annulé' };

export default async function CasePage({ params, searchParams }: { params: Promise<{ caseId: string }>; searchParams: Promise<{ signature?: string }> }) {
  const { caseId } = await params;
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect(`/connexion?suivant=/espace/dossiers/${caseId}`);
  let d;
  try { d = await caseForClient(await getDb(), user.id, caseId); } catch (e) { if (e instanceof NotFound) notFound(); throw e; }
  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-8">
      <Link href={`/espace/entreprises/${d.case.company_id}`} className="text-sm text-brand underline">← {d.case.company_name}</Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{d.case.title ?? 'Dossier'}</h1>
        <Badge tone="info" data-testid="case-status">{CASE_STATUS_LABELS[d.case.status]}</Badge>
      </div>
      {sp.signature === 'envoyee' && <Alert tone="good">Le mandat vous a été envoyé par e-mail pour signature électronique.</Alert>}
      {sp.signature === 'desactivee' && <Alert tone="warn">Votre dossier est ouvert et votre mandat est prêt. La signature électronique n’est pas encore activée sur la plateforme : le mandat n’est pas signé.</Alert>}
      {sp.signature === 'erreur' && <Alert tone="danger">L’envoi pour signature a échoué. Notre équipe a été informée et reviendra vers vous.</Alert>}
      {d.mandate && (
        <Card className="space-y-1 text-sm">
          <h2 className="font-semibold">Mandat</h2>
          <p>Statut : <strong data-testid="mandate-status">{MANDATE[d.mandate.status]}</strong> · commission {Math.round(d.mandate.commission_rate * 1000) / 10} % sur les sommes réellement remboursées · {d.mandate.terms_version}</p>
          <p className="flex flex-wrap gap-3">
            {d.mandate.unsigned_document_id && <a className="text-brand underline" href={`/documents/${d.mandate.unsigned_document_id}`}>Mandat (PDF)</a>}
            {d.mandate.signed_document_id && <a className="text-brand underline" href={`/documents/${d.mandate.signed_document_id}`}>Mandat signé (PDF)</a>}
          </p>
        </Card>
      )}
      {d.case.verification_status !== 'verifiee' && <Alert tone="info">Vérification de l’entreprise en cours par notre équipe.</Alert>}
      <Card className="space-y-3">
        <h2 className="font-semibold">Suivi</h2>
        <ol className="space-y-3 border-l-2 border-line pl-4" data-testid="timeline">
          {d.events.map((e) => (
            <li key={e.id} className="text-sm">
              <p className="text-xs text-muted">{new Date(e.created_at).toLocaleString('fr-FR')}</p>
              <p>{e.event_type === 'changement_statut' ? `Statut : ${CASE_STATUS_LABELS[e.to_status ?? ''] ?? e.to_status}` : e.message}{e.event_type === 'demande_piece' && <Badge tone="warn" className="ml-2">Pièce demandée</Badge>}</p>
            </li>
          ))}
        </ol>
      </Card>
      <Card className="space-y-3">
        <h2 className="font-semibold">Justificatifs</h2>
        <ul className="text-sm">{d.documents.map((doc) => <li key={doc.id}><a className="text-brand underline" href={`/documents/${doc.id}`}>{doc.original_filename}</a></li>)}</ul>
        {d.case.role && <UploadCaseDocument companyId={d.case.company_id} caseId={caseId} />}
      </Card>
      <Card className="space-y-2">
        <h2 className="font-semibold">Remboursements obtenus</h2>
        {d.recoveries.length === 0 ? <p className="text-sm text-muted">Aucun remboursement enregistré pour l’instant.</p> : (
          <ul className="text-sm tabular" data-testid="recoveries">{d.recoveries.map((r) => <li key={r.id}>{new Date(r.received_on).toLocaleDateString('fr-FR')} : {formatEur(r.amount_reimbursed, 2)} remboursés · commission {r.commission !== null ? formatEur(r.commission, 2) : '—'} ({r.commission_status ?? '—'})</li>)}</ul>
        )}
      </Card>
    </div>
  );
}
