import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Questionnaire } from '@/components/audit/questionnaire';
import { buttonVariants } from '@/components/ui/button';
import { Alert } from '@/components/ui/card';
import { AccessDenied, loadAudit } from '@/lib/audit-service';
import { getDb } from '@/lib/db';
import { auditAccess } from '@/lib/server/access';
import { annualSmicByYear } from '@/lib/server/smic';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Questionnaire', robots: { index: false } };

export default async function AuditPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ etape?: string }> }) {
  const { id } = await params;
  const { etape } = await searchParams;
  let loaded;
  try {
    loaded = await loadAudit(await getDb(), id, await auditAccess(id));
  } catch (e) {
    if (!(e instanceof AccessDenied)) throw e;
    return (
      <div className="mx-auto max-w-xl px-4 py-12">
        <Alert tone="warn">Cet audit n’est pas accessible depuis ce navigateur. Sans compte, un audit ne peut être repris que sur l’appareil utilisé pour le commencer ; connectez-vous pour retrouver les audits rattachés à votre compte.</Alert>
        <Link href={`/connexion?suivant=/audit/${id}`} className={buttonVariants({ variant: 'secondary', className: 'mt-6 mr-3' })}>Me connecter</Link>
        <Link href="/audit" className={buttonVariants({ className: 'mt-6' })}>Démarrer une nouvelle estimation</Link>
      </div>
    );
  }
  if (loaded.audit.status === 'calcule') redirect(`/audit/${id}/resultats`);
  if (loaded.audit.access !== 'write') redirect(`/espace`);
  const smic = await annualSmicByYear(loaded.audit.parameter_dataset, loaded.meta.years);
  let advanced: { lines: number; pending: number } | null = null;
  if (loaded.audit.mode === 'avance' && loaded.audit.company_id) {
    const db = await getDb();
    const [r] = await db.query<{ lines: number; pending: number }>(
      `select (select count(*) from public.payroll_lines where company_id = $1 and validated)::int as lines,
              (select count(*) from public.extracted_fields where company_id = $1 and status = 'a_valider')::int as pending`, [loaded.audit.company_id]);
    advanced = r ?? { lines: 0, pending: 0 };
  }
  const step = Math.max(0, Math.min(6, Number(etape ?? 1) - 1 || 0));
  return <Questionnaire auditId={id} initial={loaded.filled} meta={loaded.meta} annualSmic={smic} initialStep={step} advanced={advanced} />;
}
