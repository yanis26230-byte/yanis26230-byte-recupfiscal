import { Forbidden } from '@/lib/account-service';
import { exportParametersToFill } from '@/lib/admin-service';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Modèle CSV des paramètres officiels « à renseigner » (administrateurs uniquement). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new Response('Introuvable', { status: 404 });
  try {
    const csv = await exportParametersToFill(await getDb(), user.id);
    return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="parametres-a-renseigner.csv"', 'cache-control': 'private, no-store' } });
  } catch (e) {
    if (e instanceof Forbidden) return new Response('Introuvable', { status: 404 });
    throw e;
  }
}
