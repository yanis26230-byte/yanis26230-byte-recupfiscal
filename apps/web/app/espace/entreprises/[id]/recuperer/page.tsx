import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { RecoveryForm } from '@/components/cases/recovery-form';
import { Alert, Card } from '@/components/ui/card';
import { getCompanyView, NotFound } from '@/lib/account-service';
import { getCurrentUser } from '@/lib/auth';
import { activeTerms, commissionRate } from '@/lib/case-service';
import { getDb } from '@/lib/db';
import { getSignatureProvider } from '@/lib/signature';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Récupérer cet argent', robots: { index: false } };

export default async function RecoverPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ audit?: string }> }) {
  const { id } = await params;
  const { audit } = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect(`/connexion?suivant=/espace/entreprises/${id}/recuperer?audit=${audit ?? ''}`);
  const db = await getDb();
  let view;
  try { view = await getCompanyView(db, user.id, id); } catch (e) { if (e instanceof NotFound) notFound(); throw e; }
  const [terms, rate] = await Promise.all([activeTerms(db), commissionRate(db)]);
  const signatureEnabled = getSignatureProvider().enabled;
  const pct = `${Math.round(rate * 1000) / 10} %`;
  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-8">
      <Link href={`/espace/entreprises/${id}`} className="text-sm text-brand underline">← {view.company.legal_name}</Link>
      <h1 className="text-2xl font-bold sm:text-3xl">Je veux récupérer cet argent</h1>
      <Card className="space-y-2">
        <h2 className="font-semibold">Ce que vous payez</h2>
        <p className="text-lg"><strong>{pct}</strong> uniquement sur les sommes <strong>réellement remboursées</strong> à votre entreprise.</p>
        <p className="text-sm text-muted">Rien n’est dû si rien n’est récupéré. Aucune facturation sur une estimation. Les économies futures ne sont pas commissionnées. Le taux est figé dans votre mandat.</p>
      </Card>
      <Card className="space-y-2">
        <h2 className="font-semibold">Les étapes</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>Vérification de l’entreprise et de votre habilitation par notre équipe.</li>
          <li>Signature électronique du mandat.</li>
          <li>Dépôt des justificatifs demandés.</li>
          <li>Analyse, validation par un expert, dépôt des demandes, suivi jusqu’au remboursement.</li>
        </ol>
      </Card>
      {!terms ? (
        <Alert tone="warn">Les conditions du mandat ne sont pas encore publiées : la démarche ne peut pas être engagée pour le moment.</Alert>
      ) : view.myRole !== 'proprietaire' ? (
        <Alert tone="info">Seul un propriétaire de l’entreprise peut engager la démarche.</Alert>
      ) : !audit ? (
        <Alert tone="info">Ouvrez cette page depuis les résultats d’une estimation de l’entreprise.</Alert>
      ) : (
        <>
          <Card className="space-y-2">
            <h2 className="font-semibold">{terms.title} <span className="text-sm font-normal text-muted">(version {terms.version})</span></h2>
            <div className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-surface p-3 text-sm" data-testid="terms">{terms.body}</div>
          </Card>
          {!signatureEnabled && <Alert tone="warn" data-testid="signature-disabled">La signature électronique n’est pas encore activée sur cette plateforme : votre dossier sera ouvert et votre mandat préparé, mais il ne pourra être signé qu’après son activation.</Alert>}
          <RecoveryForm companyId={id} auditId={audit} email={user.email} />
        </>
      )}
    </div>
  );
}
