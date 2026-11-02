import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Accès SQL côté serveur uniquement. Le serveur se connecte avec un rôle de service
 * (équivalent service_role) : chaque action serveur contrôle elle-même l'accès (jeton
 * d'audit anonyme, puis session en phase 4). Aucune requête SQL n'est exposée au navigateur.
 */
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}
export interface Database extends Queryable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  /**
   * Exécute des requêtes AU NOM d'un utilisateur : rôle `authenticated` et identifiant dans le
   * claim JWT, exactement comme Supabase. Les politiques RLS s'appliquent donc pleinement.
   */
  asUser<T>(userId: string, fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function withUser(transaction: Database['transaction']): Database['asUser'] {
  return (userId, fn) => {
    if (!USER_ID.test(userId)) throw new Error('Identifiant utilisateur invalide');
    return transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
      await tx.query(`set local role authenticated`);
      return fn(tx);
    });
  };
}

export function repoRoot(): string {
  // apps/web (cwd de Next et de Vitest) -> racine du monorepo
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, 'supabase', 'migrations'))) return dir;
    dir = join(dir, '..');
  }
  throw new Error('Dossier supabase/migrations introuvable');
}

function sqlFiles(dir: string): string[] {
  return readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((f) => join(dir, f));
}

/**
 * Base locale PGlite : applique le socle Supabase, les migrations, les droits et le seed
 * (paramètres officiels « à renseigner »), puis les données de démonstration (jeu « test »).
 */
async function createPglite(dataDir: string | null): Promise<Database> {
  const { PGlite } = await import('@electric-sql/pglite');
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const db = dataDir ? new PGlite(dataDir) : new PGlite();
  await db.waitReady;
  const initialised = (await db.query<{ ok: boolean }>(`select to_regclass('public.audits') is not null as ok`)).rows[0]?.ok;
  if (!initialised) {
    const root = repoRoot();
    await db.exec(readFileSync(join(root, 'supabase/local/supabase-stub.sql'), 'utf8'));
    for (const f of sqlFiles(join(root, 'supabase/migrations'))) await db.exec(readFileSync(f, 'utf8'));
    await db.exec(readFileSync(join(root, 'supabase/local/grants.sql'), 'utf8'));
    await db.exec(readFileSync(join(root, 'supabase/local/local-auth.sql'), 'utf8'));
    await db.exec(readFileSync(join(root, 'supabase/seed.sql'), 'utf8'));
    const { seedDemoData } = await import('./demo-seed');
    await seedDemoData({ query: async (sql, params) => (await db.query(sql, params)).rows as never });
  }
  let chain: Promise<unknown> = Promise.resolve();
  const wrap = (q: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>): Queryable => ({
    query: async (sql, params) => (await q(sql, params)).rows as never,
  });
  // PGlite est mono-connexion : on sérialise les transactions.
  const transaction: Database['transaction'] = (fn) => {
    const run = chain.then(() => db.transaction((tx) => fn(wrap((s, p) => tx.query(s, p)))));
    chain = run.catch(() => undefined);
    return run;
  };
  return {
    query: async (sql, params) => {
      // Les requêtes hors transaction attendent la fin des transactions en cours.
      await chain;
      return (await db.query(sql, params)).rows as never;
    },
    transaction,
    asUser: withUser(transaction),
    close: () => db.close(),
  };
}

async function createPg(url: string): Promise<Database> {
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: url, max: 10, ssl: url.includes('localhost') ? undefined : { rejectUnauthorized: true } });
  const transaction: Database['transaction'] = async (fn) => {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const r = await fn({ query: async (sql, params) => (await client.query(sql, params as unknown[])).rows });
        await client.query('commit');
        return r;
      } catch (e) {
        await client.query('rollback');
        throw e;
      } finally {
        client.release();
      }
  };
  return {
    query: async (sql, params) => (await pool.query(sql, params as unknown[])).rows,
    transaction,
    asUser: withUser(transaction),
    close: () => pool.end(),
  };
}

export async function createDatabase(opts: { databaseUrl?: string; pgliteDataDir?: string | null }): Promise<Database> {
  if (opts.databaseUrl) return createPg(opts.databaseUrl);
  return createPglite(opts.pgliteDataDir ?? null);
}
