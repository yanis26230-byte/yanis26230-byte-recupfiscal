import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PayrollEditor } from '@/components/documents/payroll-editor';
import { Alert, Card } from '@/components/ui/card';
import { getCompanyView, NotFound } from '@/lib/account-service';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { listEmployeesWithPayroll, payrollSummary } from '@/lib/documents/service';
import { todayInParis } from '@/lib/server/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Paie', robots: { index: false } };

export default async function PayrollPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ annee?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect(`/connexion?suivant=/espace/entreprises/${id}/paie`);
  const db = await getDb();
  let view;
  try { view = await getCompanyView(db, user.id, id); } catch (e) { if (e instanceof NotFound) notFound(); throw e; }
  const current = Number(todayInParis().slice(0, 4));
  const years = [current - 3, current - 2, current - 1, current];
  const year = years.includes(Number(sp.annee)) ? Number(sp.annee) : current - 1;
  const [summary, employees] = await Promise.all([payrollSummary(db, user.id, id), listEmployeesWithPayroll(db, user.id, id, year)]);
  const canWrite = view.myRole === 'proprietaire' || view.myRole === 'collaborateur';
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <Link href={`/espace/entreprises/${id}`} className="text-sm text-brand underline">← {view.company.legal_name}</Link>
      <h1 className="text-2xl font-bold sm:text-3xl">Données de paie (mode avancé)</h1>
      <Alert tone="info">Salariés identifiés uniquement par un identifiant interne : n’indiquez ni nom ni numéro de sécurité sociale. Les montants saisis ici sont vos déclarations et sont utilisés tels quels ; ceux lus dans des documents doivent d’abord être validés.</Alert>
      <Card>
        <h2 className="text-lg font-semibold">Données disponibles</h2>
        {summary.length === 0 ? <p className="text-sm text-muted">Aucune ligne de paie validée.</p> : (
          <ul className="mt-2 text-sm" data-testid="payroll-summary">{summary.map((s) => <li key={s.year}>{s.year} : {s.employees} salarié(s), {s.lines} mois ({s.manual} saisis, {s.extracted} issus de documents validés)</li>)}</ul>
        )}
      </Card>
      <nav className="flex flex-wrap gap-2" aria-label="Année">
        {years.map((y) => <Link key={y} href={`?annee=${y}`} className={`min-h-11 rounded-lg border px-4 py-2 text-sm font-semibold ${y === year ? 'border-brand bg-brand text-white' : 'border-line bg-white'}`}>{y}</Link>)}
      </nav>
      {/* key : un nouvel éditeur par année, sinon React conserverait les mois de l'année précédente. */}
      <PayrollEditor key={year} companyId={id} year={year} canWrite={canWrite} establishments={view.establishments.map((e) => ({ id: e.id, label: `${e.city ?? '—'}${e.siret ? ` (${e.siret})` : ''}` }))}
        employees={employees.map((e) => ({ ref: e.internal_id, contract: e.contract_type, months: e.months }))} />
    </div>
  );
}
