/**
 * Processus de fond : traite la file d'extraction documentaire (production).
 * Usage : pnpm --filter @recupfiscal/web worker
 */
import { createDatabase } from '../lib/db/database';
import { processPendingJobs } from '../lib/documents/service';
import { getFileStore } from '../lib/storage';

const INTERVAL_MS = Number(process.env.WORKER_INTERVAL_MS ?? 5000);

async function main() {
  const db = await createDatabase({ databaseUrl: process.env.DATABASE_URL, pgliteDataDir: process.env.PGLITE_DATA_DIR ?? '.data/pglite' });
  const store = getFileStore();
  let stop = false;
  process.on('SIGTERM', () => { stop = true; });
  process.on('SIGINT', () => { stop = true; });
  console.log(JSON.stringify({ level: 'info', msg: 'worker démarré', intervalMs: INTERVAL_MS }));
  while (!stop) {
    try {
      const n = await processPendingJobs(db, store, 20);
      if (n) console.log(JSON.stringify({ level: 'info', msg: 'documents traités', count: n }));
    } catch (e) {
      console.error(JSON.stringify({ level: 'error', msg: 'worker', error: String(e) }));
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
  await db.close();
}
void main();
