import Link from 'next/link';
import { redirect } from 'next/navigation';
import { buttonVariants } from '@/components/ui/button';
import { Alert, Badge, Card } from '@/components/ui/card';
import { listMyAudits, listMyCompanies, listPendingCompanyAccess, ROLE_LABELS } from '@/lib/account-service';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { listNotifications } from '@/lib/case-service';
import { markNotificationsReadAction } from '@/app/actions';
import { formatEur } from '@/lib/questionnaire';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Mon espace', robots: { index: false } };

const STATUS: Record<string, string> = { brouillon: 'Brouillon', en_cours: 'En cours', calcule: 'Calculé', archive: 'Archivé' };

export default async function SpacePage({ searchParams }: { searchParams: Promise<{ bienvenue?: string; rattaches?: string; acces?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/connexion?suivant=/espace');
  const sp = await searchParams;
  const db = await getDb();
  const [companies, audits, pending, notifications] = await Promise.all([listMyCompanies(db, user.id), listMyAudits(db, user.id), listPendingCompanyAccess(db, user.id), listNotifications(db, user.id)]);
  const unread = notifications.filter((n) => !n.read_at);
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">Mon espace</h1>
        <p className="text-sm text-muted">Connecté avec {user.email} · <Link href="/espace/compte" className="text-brand underline">Mon compte et mes données</Link></p>
      </div>
      {sp.rattaches && <Alert tone="good">{sp.rattaches === '1' ? 'Votre estimation a été rattachée à votre espace.' : `${sp.rattaches} estimations ont été rattachées à votre espace.`}</Alert>}
      {pending.length > 0 && (
        <Alert tone="warn" data-testid="pending-access">
          {pending.map((p) => p.company_name).join(', ')} {pending.length > 1 ? 'disposent' : 'dispose'} déjà d’un espace sur la plateforme. Votre estimation reste dans votre espace personnel :
          demandez à un propriétaire de cette entreprise de vous inviter pour la partager avec elle.
        </Alert>
      )}

      {unread.length > 0 && (
        <Card className="space-y-2" data-testid="notifications">
          <div className="flex items-center justify-between"><h2 className="font-semibold">Notifications ({unread.length})</h2>
            <form action={markNotificationsReadAction}><button className="text-sm text-brand underline">Tout marquer comme lu</button></form></div>
          <ul className="space-y-1 text-sm">{unread.slice(0, 8).map((n) => <li key={n.id}>{n.payload.caseId ? <Link className="text-brand underline" href={`/espace/dossiers/${n.payload.caseId}`}>{n.payload.subject}</Link> : n.payload.subject} <span className="text-muted">· {new Date(n.created_at).toLocaleDateString('fr-FR')}</span></li>)}</ul>
        </Card>
      )}

      <section className="space-y-3" aria-labelledby="mes-entreprises">
        <h2 id="mes-entreprises" className="text-xl font-bold">Mes entreprises</h2>
        {companies.length === 0 && <p className="text-muted">Aucune entreprise pour l’instant.</p>}
        <ul className="grid gap-3 sm:grid-cols-2">
          {companies.map((c) => (
            <li key={c.id}>
              <Link href={`/espace/entreprises/${c.id}`} className="block rounded-2xl border border-line bg-white p-4 hover:border-brand">
                <span className="block font-semibold">{c.legal_name}</span>
                <span className="mt-1 block text-sm text-muted">SIREN {c.siren}</span>
                <span className="mt-2 flex flex-wrap gap-2"><Badge tone="info">{ROLE_LABELS[c.role]?.split(' (')[0]}</Badge>{c.verification_status !== 'verifiee' && <Badge tone="warn">Rattachement non vérifié</Badge>}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3" aria-labelledby="mes-audits">
        <div className="flex items-center justify-between gap-3">
          <h2 id="mes-audits" className="text-xl font-bold">Mes estimations</h2>
          <Link href="/audit" className={buttonVariants({ size: 'sm' })}>Nouvelle estimation</Link>
        </div>
        {audits.length === 0 && <p className="text-muted">Aucune estimation.</p>}
        <ul className="space-y-3">
          {audits.map((a) => (
            <li key={a.id}>
              <Card className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-4">
                <div>
                  <p className="font-semibold">{a.company_name ?? a.legal_name_answer ?? 'Estimation'} {a.is_demo && <Badge tone="warn">Démo fictive</Badge>}</p>
                  <p className="text-sm text-muted">{STATUS[a.status] ?? a.status} · créée le {new Date(a.created_at).toLocaleDateString('fr-FR')}{a.company_id ? '' : ' · personnelle'}</p>
                  {a.status === 'calcule' && (a.past_high ?? 0) > 0 && <p className="text-sm text-money tabular">Récupération estimée : {formatEur(a.past_low ?? 0)} à {formatEur(a.past_high ?? 0)}</p>}
                </div>
                <Link href={a.status === 'calcule' ? `/audit/${a.id}/resultats` : `/audit/${a.id}`} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
                  {a.status === 'calcule' ? 'Voir les résultats' : 'Reprendre'}
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
