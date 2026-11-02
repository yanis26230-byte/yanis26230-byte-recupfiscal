import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { LeadForm } from '@/components/audit/lead-form';
import { OpportunityCard } from '@/components/audit/opportunity-card';
import { ReportPanel } from '@/components/audit/report-panel';
import { listReports } from '@/lib/report/report-service';
import { buttonVariants } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { AccessDenied, getResults } from '@/lib/audit-service';
import { getDb } from '@/lib/db';
import { DISCLAIMER, formatEur } from '@/lib/questionnaire';
import { auditAccess } from '@/lib/server/access';
import { authProvider } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Votre estimation', robots: { index: false } };


export default async function ResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let results;
  let reports: Awaited<ReturnType<typeof listReports>> = [];
  try {
    const acc = await auditAccess(id);
    results = await getResults(await getDb(), id, acc);
    if (results?.detailAllowed) reports = await listReports(await getDb(), id, acc);
    if (results?.viaAccount && results.companyId && acc.userId && !results.isDemo) {
      const [m] = await (await getDb()).asUser(acc.userId, (q) => q.query<{ role: string }>(`select app.company_role($1)::text as role`, [results!.companyId]));
      results.canStartRecovery = m?.role === 'proprietaire';
    }
  } catch (e) {
    if (e instanceof AccessDenied) notFound();
    throw e;
  }
  if (!results) redirect(`/audit/${id}?etape=7`);
  const { totals, commission, counts } = results;
  const past = totals.pastRecovery;
  const future = totals.futureAnnualSavings;
  const pct = `${Math.round(commission.rate * 100)} %`;
  const hasPast = past.high > 0;
  // Le détail par dispositif est réservé aux comptes ayant accès à l'audit (et à la démonstration).
  const showDetail = results.detailAllowed;
  const pistes = counts.a_confirmer + counts.informations_manquantes;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:py-12">
      {results.isDemo && <Alert tone="warn">Démonstration : entreprise <strong>fictive</strong> et paramètres de <strong>test fictifs</strong>. Ces montants n’ont aucune valeur réglementaire.</Alert>}
      <div>
        <p className="text-sm font-semibold text-brand">Estimation pour {results.companyName}</p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Votre estimation</h1>
        <p className="mt-1 text-sm text-muted">Calcul du {new Date(`${results.asOfDate}T12:00:00Z`).toLocaleDateString('fr-FR')} · référence {results.runId.slice(0, 8)}</p>
      </div>

      <section aria-labelledby="ind-past">
        <Card className="border-2 border-green-200">
          <h2 id="ind-past" className="text-sm font-semibold uppercase tracking-wide text-muted">1. Récupération passée estimée</h2>
          {hasPast ? (
            <p className="mt-2 text-2xl font-bold text-money tabular sm:text-3xl" data-testid="past-range">Entre {formatEur(past.low)} et {formatEur(past.high)}</p>
          ) : (
            <p className="mt-2 text-lg font-semibold">Aucun montant chiffré à ce stade</p>
          )}
          <p className="mt-1 text-sm text-muted">potentiellement récupérables sur les périodes encore réclamables.</p>
        </Card>
      </section>

      <section aria-labelledby="ind-com">
        <Card>
          <h2 id="ind-com" className="text-sm font-semibold uppercase tracking-wide text-muted">2. Commission indicative de {pct}</h2>
          {hasPast ? (
            <>
              <p className="mt-2 text-lg font-semibold tabular" data-testid="commission">Entre {formatEur(commission.commission.low)} et {formatEur(commission.commission.high)}</p>
              <p className="text-sm text-muted tabular">Gain net estimé pour vous : entre {formatEur(commission.netGain.low)} et {formatEur(commission.netGain.high)}.</p>
            </>
          ) : <p className="mt-2 text-sm text-muted">Aucune commission sans récupération.</p>}
          <p className="mt-2 text-sm text-muted">La commission porte uniquement sur les sommes réellement remboursées. Rien n’est dû si rien n’est récupéré.</p>
        </Card>
      </section>

      <section aria-labelledby="ind-fut">
        <Card>
          <h2 id="ind-fut" className="text-sm font-semibold uppercase tracking-wide text-muted">3. Économies annuelles futures estimées</h2>
          {future.high > 0
            ? <p className="mt-2 text-2xl font-bold text-brand tabular" data-testid="future">Jusqu’à {formatEur(future.high)} par an</p>
            : <p className="mt-2 text-lg font-semibold">Aucune économie future chiffrée à ce stade</p>}
          <p className="mt-1 text-sm text-muted">Offertes : ces économies ne sont pas commissionnées.</p>
        </Card>
      </section>

      {results.yearsAwaitingParameters.length > 0 && (
        <Alert tone="info">
          Les paramètres réglementaires de {results.yearsAwaitingParameters.join(', ')} sont en cours de vérification par notre équipe. Les dispositifs concernés seront chiffrés
          dès leur validation : nous n’utilisons jamais de valeur approximative ou d’une autre année.
        </Alert>
      )}
      {results.canStartRecovery && (hasPast || pistes > 0 || counts.parametre_manquant > 0) && (
        <Card className="space-y-2 border-2 border-brand">
          <h2 className="text-lg font-bold">Je veux récupérer cet argent</h2>
          <p className="text-sm text-muted">
            {hasPast ? 'Nous vérifions chaque opportunité sur pièces et engageons les démarches.' : 'Aucun montant n’est encore chiffré, mais des pistes sont identifiées : nous pouvons les instruire sur pièces.'}{' '}
            {pct} uniquement sur les sommes réellement remboursées, rien sinon.
          </p>
          <Link href={`/espace/entreprises/${results.companyId}/recuperer?audit=${id}`} className={buttonVariants({ size: 'lg', className: 'w-full sm:w-auto' })}>Je veux récupérer cet argent</Link>
        </Card>
      )}
      {pistes > 0 && <p className="text-sm text-muted">{pistes} autre(s) piste(s) identifiée(s) sans montant, à confirmer avec vos documents.</p>}

      {showDetail ? (
        <section aria-labelledby="detail" className="space-y-3">
          <h2 id="detail" className="text-xl font-bold">Détail par dispositif</h2>
          {results.opportunities.map((o, i) => <OpportunityCard key={`${o.moduleId}-${o.year}-${o.kind}-${i}`} o={o} />)}
          <ReportPanel auditId={id} reports={reports} />
        </section>
      ) : (
        <Card className="space-y-4">
          <h2 className="text-xl font-bold">Voir le détail par dispositif</h2>
          <p className="text-sm text-muted">Le détail de chaque opportunité et les documents à fournir sont accessibles depuis votre espace personnel. Indiquez votre adresse : vous recevrez un lien de connexion qui crée votre espace et y rattache cette estimation.</p>
          <LeadForm auditId={id} alreadyCaptured={results.leadCaptured} devOutbox={authProvider() === 'local' && process.env.NODE_ENV !== 'production'} />
        </Card>
      )}

      <p className="rounded-xl bg-white p-4 text-xs text-muted" data-testid="disclaimer">{DISCLAIMER}</p>
      <div className="flex flex-col gap-3 sm:flex-row">
        {results.viaAccount && <Link href="/espace" className={buttonVariants({})}>Mon espace</Link>}
        <Link href="/audit" className={buttonVariants({ variant: 'secondary' })}>Nouvelle estimation</Link>
      </div>
    </div>
  );
}
