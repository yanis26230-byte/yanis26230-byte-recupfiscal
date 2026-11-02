import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { exportMyData } from '@/lib/privacy-service';

export const dynamic = 'force-dynamic';

/** Export RGPD (portabilité) : fichier JSON des données de l'utilisateur. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new Response('Non connecté', { status: 401 });
  const data = await exportMyData(await getDb(), user);
  return new Response(JSON.stringify(data, null, 2), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="mes-donnees-${new Date().toISOString().slice(0, 10)}.json"`, 'cache-control': 'private, no-store' },
  });
}
