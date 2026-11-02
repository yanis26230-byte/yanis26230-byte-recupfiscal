import 'server-only';
import { getDb } from '@/lib/db';

export async function getCommissionRate(): Promise<number> {
  const db = await getDb();
  const [r] = await db.query<{ rate: number }>(`select commission_rate::float8 as rate from public.commercial_settings where id = 1`);
  return r?.rate ?? 0.25;
}
