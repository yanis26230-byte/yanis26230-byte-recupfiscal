/**
 * Attribue un rôle interne à un compte existant (amorçage du premier administrateur).
 * Usage : pnpm --filter @recupfiscal/web admin:grant <email> <analyste|administrateur>
 * La personne doit s'être connectée au moins une fois. Action journalisée (audit_logs).
 */
import { createDatabase } from '../lib/db/database';

async function main() {
  const [email, role] = process.argv.slice(2);
  if (!email || !['analyste', 'administrateur'].includes(role ?? '')) {
    console.error('Usage : admin:grant <email> <analyste|administrateur>');
    process.exit(1);
  }
  const db = await createDatabase({ databaseUrl: process.env.DATABASE_URL, pgliteDataDir: process.env.PGLITE_DATA_DIR ?? '.data/pglite' });
  const r = await db.query(`update public.users set internal_role = $2 where lower(email) = lower($1) returning id`, [email, role]);
  console.log(r.length ? `Rôle ${role} attribué à ${email}.` : `Aucun compte pour ${email} : connectez-vous d’abord une fois.`);
  await db.close();
  process.exit(r.length ? 0 : 2);
}
void main();
