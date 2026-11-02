import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { FieldsReview } from '@/components/documents/fields-review';
import { Alert } from '@/components/ui/card';
import { NotFound } from '@/lib/account-service';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getDocumentWithFields } from '@/lib/documents/service';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Validation du document', robots: { index: false } };

export default async function DocumentPage({ params }: { params: Promise<{ id: string; docId: string }> }) {
  const { id, docId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect('/connexion');
  let data;
  try { data = await getDocumentWithFields(await getDb(), user.id, docId); } catch (e) { if (e instanceof NotFound) notFound(); throw e; }
  if (data.doc.company_id !== id) notFound();
  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-8">
      <Link href={`/espace/entreprises/${id}/documents`} className="text-sm text-brand underline">← Documents</Link>
      <h1 className="break-all text-2xl font-bold">{data.doc.original_filename}</h1>
      {data.doc.processing_notes.length > 0 && <Alert tone="info"><ul className="list-disc pl-5">{data.doc.processing_notes.map((n) => <li key={n}>{n}</li>)}</ul></Alert>}
      {data.doc.status === 'extraction_manuelle' && (
        <Alert tone="warn">Aucune valeur n’a pu être lue automatiquement. Saisissez les données utiles dans la <Link className="underline" href={`/espace/entreprises/${id}/paie`}>saisie de la paie</Link>.</Alert>
      )}
      {data.fields.length > 0 && <FieldsReview path={`/espace/entreprises/${id}/documents/${docId}`} fields={data.fields} canWrite={data.doc.can_write} />}
    </div>
  );
}
