/**
 * Applique les migrations et les données de départ sur la base de DATABASE_URL (Supabase).
 * Usage : DATABASE_URL=… pnpm --filter @recupfiscal/web migrate
 */
import { createDatabase, repoRoot } from '../lib/db/database';
import { migrate } from '../lib/db/migrate';

async function main() {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL est requis (base Supabase).'); process.exit(1); }
  const db = await createDatabase({ databaseUrl: process.env.DATABASE_URL });
  try {
    const r = await migrate(db, repoRoot(), { log: (m) => console.log(m) });
    console.log(JSON.stringify({ level: 'info', msg: 'migrations', appliquees: r.applied.length, dejaAppliquees: r.alreadyApplied, seed: r.seeded }));
  } finally {
    await db.close();
  }
}
main().catch((e) => { console.error(String(e)); process.exit(1); });
