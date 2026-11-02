import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AdvancedAuditButton } from '@/components/account/advanced-button';
import { InviteForm, MemberRow, RevokeInvitationButton } from '@/components/account/members';
import { Alert, Badge, Card } from '@/components/ui/card';
import { getCompanyView, NotFound, ROLE_LABELS } from '@/lib/account-service';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { CASE_STATUS_LABELS, companyFinancials, listCompanyCases } from '@/lib/case-service';
import { formatEur } from '@/lib/questionnaire';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Entreprise', robots: { index: false } };

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/connexion?suivant=/espace/entreprises/${id}`);
  let view;
  try {
    view = await getCompanyView(await getDb(), user.id, id);
  } catch (e) {
    if (e instanceof NotFound) notFound();
    throw e;
  }
  const isOwner = view.myRole === 'proprietaire';
  const [cases, money] = await Promise.all([listCompanyCases(await getDb(), user.id, id), companyFinancials(await getDb(), user.id, id)]);
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <Link href="/espace" className="text-sm text-brand underline">← Mon espace</Link>
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">{view.company.legal_name}</h1>
        <p className="text-sm text-muted">SIREN {view.company.siren} · {view.company.legal_form ?? '—'} · NAF {view.company.naf_code ?? '—'}</p>
        <p className="mt-2"><Badge tone="info">Votre rôle : {ROLE_LABELS[view.myRole] ?? view.myRole}</Badge></p>
      </div>
      {view.company.verification_status !== 'verifiee' && (
        <Alert tone="info">Le rattachement de votre compte à cette entreprise est déclaratif. Il sera vérifié avant toute démarche de récupération (mandat).</Alert>
      )}

      <Card className="space-y-3">
        <h2 className="text-lg font-semibold">Dossiers de récupération</h2>
        {cases.length === 0 ? <p className="text-sm text-muted">Aucun dossier. Depuis les résultats d’une estimation, cliquez sur « Je veux récupérer cet argent ».</p> : (
          <ul className="divide-y divide-line text-sm" data-testid="cases">{cases.map((c) => <li key={c.id} className="flex items-center justify-between py-2"><Link className="text-brand underline" href={`/espace/dossiers/${c.id}`}>{c.title ?? 'Dossier'}</Link><span>{CASE_STATUS_LABELS[c.status]}</span></li>)}</ul>
        )}
        <dl className="grid grid-cols-3 gap-2 text-sm tabular">
          <div><dt className="text-muted">Remboursements obtenus</dt><dd className="font-semibold text-money">{formatEur(money.recovered)}</dd></div>
          <div><dt className="text-muted">Commissions dues</dt><dd className="font-semibold">{formatEur(money.commissions_due)}</dd></div>
          <div><dt className="text-muted">Commissions réglées</dt><dd className="font-semibold">{formatEur(money.commissions_paid)}</dd></div>
        </dl>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-lg font-semibold">Analyse avancée</h2>
        <p className="text-sm text-muted">Pour une estimation précise : déposez vos DSN, journaux de paie et notifications de taux AT, validez les valeurs lues, ou saisissez la paie mois par mois. Le calcul se fait alors salarié par salarié.</p>
        <div className="flex flex-wrap gap-3">
          <Link href={`/espace/entreprises/${id}/documents`} className="rounded-lg border border-line px-4 py-2.5 text-sm font-semibold hover:bg-surface">Documents</Link>
          <Link href={`/espace/entreprises/${id}/paie`} className="rounded-lg border border-line px-4 py-2.5 text-sm font-semibold hover:bg-surface">Saisie de la paie</Link>
        </div>
        {(isOwner || view.myRole === 'collaborateur') && <AdvancedAuditButton companyId={id} />}
      </Card>

      <Card className="space-y-3">
        <h2 className="text-lg font-semibold">Établissements</h2>
        <ul className="divide-y divide-line text-sm">
          {view.establishments.map((e) => <li key={e.id} className="py-2">{e.city ?? '—'} {e.siret ? `· SIRET ${e.siret}` : ''}<span className="block text-muted">{e.address} {e.postal_code}</span></li>)}
        </ul>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-lg font-semibold">Estimations de l’entreprise</h2>
        {view.audits.length === 0 ? <p className="text-sm text-muted">Aucune estimation rattachée.</p> : (
          <ul className="divide-y divide-line text-sm">
            {view.audits.map((a) => <li key={a.id} className="flex items-center justify-between py-2"><span>{new Date(a.created_at).toLocaleDateString('fr-FR')} · {a.mode === 'avance' ? 'avancée' : 'rapide'} · {a.status === 'calcule' ? 'calculée' : 'en cours'}</span>
              <Link className="text-brand underline" href={a.status === 'calcule' ? `/audit/${a.id}/resultats` : `/audit/${a.id}`}>{a.status === 'calcule' ? 'Résultats' : 'Reprendre'}</Link></li>)}
          </ul>
        )}
      </Card>

      <Card className="space-y-3">
        <h2 className="text-lg font-semibold">Membres</h2>
        <ul className="divide-y divide-line" data-testid="members">
          {view.members.map((m) => <MemberRow key={m.user_id} companyId={id} member={m} isOwner={isOwner} isMe={m.user_id === user.id} />)}
        </ul>
      </Card>

      {isOwner && (
        <Card className="space-y-4">
          <h2 className="text-lg font-semibold">Inviter un membre</h2>
          <InviteForm companyId={id} />
          {view.invitations.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Invitations en attente</h3>
              <ul className="divide-y divide-line text-sm" data-testid="invitations">
                {view.invitations.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-2 py-2">
                    <span>{i.email} · {ROLE_LABELS[i.role]?.split(' (')[0]} {i.expired && <Badge tone="warn">Expirée</Badge>}</span>
                    <RevokeInvitationButton companyId={id} invitationId={i.id} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
