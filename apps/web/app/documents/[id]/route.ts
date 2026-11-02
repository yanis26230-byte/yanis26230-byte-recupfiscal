import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getFileStore } from '@/lib/storage';

export const dynamic = 'force-dynamic';

/** Téléchargement d'un document : membres de l'entreprise et équipe interne uniquement (RLS). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user || !/^[0-9a-f-]{36}$/i.test(id)) return new Response('Introuvable', { status: 404 });
  const db = await getDb();
  const [doc] = await db.asUser(user.id, (q) => q.query<{ storage_path: string; original_filename: string; mime_type: string }>(
    `select storage_path, original_filename, mime_type from public.documents where id = $1`, [id]));
  if (!doc) return new Response('Introuvable', { status: 404 });
  const bytes = await getFileStore().get('documents', doc.storage_path);
  if (!bytes) return new Response('Fichier indisponible', { status: 404 });
  return new Response(new Uint8Array(bytes), {
    headers: { 'content-type': doc.mime_type, 'content-disposition': `attachment; filename="${doc.original_filename.replace(/"/g, '')}"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' },
  });
}
