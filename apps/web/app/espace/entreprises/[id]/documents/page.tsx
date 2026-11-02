import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { UploadForm } from '@/components/documents/upload-form';
import { Alert, Badge, Card } from '@/components/ui/card';
import { getCompanyView, NotFound } from '@/lib/account-service';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { listDocuments } from '@/lib/documents/service';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Documents', robots: { index: false } };

const STATUS: Record<string, { label: string; tone: 'neutral' | 'good' | 'warn' | 'info' | 'danger' }> = {
  recu: { label: 'Analyse en cours', tone: 'info' }, controle: { label: 'Analyse en cours', tone: 'info' }, en_extraction: { label: 'Analyse en cours', tone: 'info' },
  extrait: { label: 'À valider', tone: 'warn' }, valide: { label: 'Validé', tone: 'good' }, rejete: { label: 'Refusé', tone: 'danger' },
  extraction_manuelle: { label: 'Saisie manuelle requise', tone: 'neutral' },
};
const TYPES: Record<string, string> = { dsn: 'DSN', journal_paie: 'Journal de paie', notification_at: 'Notification de taux AT', bulletin_paie: 'Bulletin de paie',
  contrat_apprentissage: 'Contrat d’apprentissage', justificatif_aide: 'Justificatif d’aide', liasse_fiscale: 'Liasse fiscale', inconnu: 'Type non reconnu' };

export default async function DocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/connexion?suivant=/espace/entreprises/${id}/documents`);
  const db = await getDb();
  let view;
  try { view = await getCompanyView(db, user.id, id); } catch (e) { if (e instanceof NotFound) notFound(); throw e; }
  const docs = await listDocuments(db, user.id, id);
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <Link href={`/espace/entreprises/${id}`} className="text-sm text-brand underline">← {view.company.legal_name}</Link>
      <h1 className="text-2xl font-bold sm:text-3xl">Documents</h1>
      <Card className="space-y-3">
        <h2 className="text-lg font-semibold">Déposer un document</h2>
        <p className="text-sm text-muted">PDF, CSV, XLSX ou fichier DSN, 15 Mo maximum. Journal de paie : utilisez le <a href="/modeles/journal-paie.csv" className="text-brand underline" download>modèle CSV</a> (identifiant interne, sans nom de salarié).</p>
        <UploadForm companyId={id} />
        <Alert tone="info">Chaque valeur lue dans un document doit être validée avant d’être utilisée dans un calcul. Aucune donnée n’est transmise à un service d’intelligence artificielle.</Alert>
      </Card>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Documents déposés</h2>
        {docs.length === 0 && <p className="text-muted">Aucun document.</p>}
        <ul className="space-y-3">
          {docs.map((d) => (
            <li key={d.id}>
              <Link href={`/espace/entreprises/${id}/documents/${d.id}`} className="block rounded-2xl border border-line bg-white p-4 hover:border-brand" data-testid="document-row">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium break-all">{d.original_filename}</span>
                  <Badge tone={STATUS[d.status]?.tone ?? 'neutral'}>{STATUS[d.status]?.label ?? d.status}</Badge>
                </span>
                <span className="mt-1 block text-sm text-muted">{TYPES[d.document_type ?? ''] ?? 'Analyse en cours'} · {d.pending} à valider · {d.validated} validée(s) · {d.rejected} rejetée(s)</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
