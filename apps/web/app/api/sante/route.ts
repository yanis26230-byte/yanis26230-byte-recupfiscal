import { getDb } from '@/lib/db';
import { log } from '@/lib/log';

export const dynamic = 'force-dynamic';

/** Point de santé pour la supervision (disponibilité de l'application et de la base). */
export async function GET() {
  const started = Date.now();
  try {
    const db = await getDb();
    await db.query('select 1');
    const [jobs] = await db.query<{ waiting: number; failed: number }>(`select count(*) filter (where status = 'en_attente')::int as waiting, count(*) filter (where status = 'echec')::int as failed from public.jobs`);
    return Response.json({ status: 'ok', database: 'ok', latencyMs: Date.now() - started, jobs }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    log.error('santé', e);
    return Response.json({ status: 'erreur', database: 'indisponible' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}
