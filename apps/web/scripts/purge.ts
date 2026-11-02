/**
 * Purge selon les durées de conservation (à planifier quotidiennement, ex. cron de l'hébergeur).
 * Usage : pnpm --filter @recupfiscal/web purge
 */
import { createDatabase } from '../lib/db/database';
import { purgeExpired, purgeLocalAuth } from '../lib/privacy-service';

async function main() {
  const db = await createDatabase({ databaseUrl: process.env.DATABASE_URL, pgliteDataDir: process.env.PGLITE_DATA_DIR ?? '.data/pglite' });
  const r = await purgeExpired(db);
  const local = process.env.DATABASE_URL ? 0 : await purgeLocalAuth(db);
  console.log(JSON.stringify({ level: 'info', msg: 'purge', ...r, authLocale: local }));
  await db.close();
}
void main();
