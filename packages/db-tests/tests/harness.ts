import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '../../../supabase/migrations');

const LOCAL = join(dirname(fileURLToPath(import.meta.url)), '../../../supabase/local');
const SUPABASE_STUB = readFileSync(join(LOCAL, 'supabase-stub.sql'), 'utf8');
const GRANTS = readFileSync(join(LOCAL, 'grants.sql'), 'utf8');

export async function createDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  }
  await db.exec(GRANTS);
  return db;
}

export type Q = <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;

/** Exécute fn en tant qu'utilisateur authentifié (RLS active), dans une transaction. */
export async function asUser<T>(db: PGlite, userId: string | null, fn: (q: Q) => Promise<T>, role = 'authenticated'): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? '']);
    await tx.exec(`set local role ${role}`);
    const q: Q = async (sql, params) => (await tx.query(sql, params)).rows as never;
    return fn(q);
  });
}

export async function createAuthUser(db: PGlite, id: string, email: string, internalRole?: 'analyste' | 'administrateur') {
  await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email]);
  if (internalRole) await db.query('update public.users set internal_role = $2 where id = $1', [id, internalRole]);
}
