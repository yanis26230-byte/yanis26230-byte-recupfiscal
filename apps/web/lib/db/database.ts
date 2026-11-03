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
  /** Exécute un script SQL de plusieurs instructions (migrations), sans paramètre. */
  exec(sql: string): Promise<void>;
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
    exec: async (sql) => { await chain; await db.exec(sql); },
    transaction,
    asUser: withUser(transaction),
    close: () => db.close(),
  };
}

export interface PgSslOptions { ca?: string; caFile?: string; disable?: boolean }

/**
 * Configuration TLS de la connexion PostgreSQL : le certificat du serveur est TOUJOURS vérifié
 * (hors base locale). Pour Supabase, fournir le certificat racine du projet (Database Settings >
 * SSL Configuration) via DATABASE_SSL_CA (contenu PEM) ou DATABASE_SSL_CA_FILE (chemin).
 * Les paramètres sslmode/sslrootcert de l'URL sont retirés : la configuration ci-dessous fait foi.
 */
export function buildPgConfig(url: string, opts: PgSslOptions = {}, readFile: (p: string) => string = (p) => readFileSync(p, 'utf8')) {
  const u = new URL(url);
  for (const k of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'ssl']) u.searchParams.delete(k);
  const local = ['localhost', '127.0.0.1', '::1'].includes(u.hostname);
  if (opts.disable && !local) throw new Error('TLS ne peut être désactivé que pour une base locale');
  const ca = opts.ca?.replace(/\\n/g, '\n') ?? (opts.caFile ? readFile(opts.caFile) : undefined);
  if (ca && !ca.includes('BEGIN CERTIFICATE')) throw new Error('DATABASE_SSL_CA ne contient pas de certificat PEM');
  return {
    connectionString: u.toString(),
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    ssl: local || opts.disable ? false : ({ rejectUnauthorized: true, ...(ca ? { ca } : {}) } as const),
  };
}

async function createPg(url: string): Promise<Database> {
  const { Pool } = await import('pg');
  const pool = new Pool(buildPgConfig(url, { ca: process.env.DATABASE_SSL_CA, caFile: process.env.DATABASE_SSL_CA_FILE, disable: process.env.DATABASE_SSL === 'disable' }));
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
    // Protocole simple : plusieurs instructions, une transaction implicite par script.
    exec: async (sql) => { await pool.query(sql); },
    transaction,
    asUser: withUser(transaction),
    close: () => pool.end(),
  };
}

export async function createDatabase(opts: { databaseUrl?: string; pgliteDataDir?: string | null }): Promise<Database> {
  if (opts.databaseUrl) return createPg(opts.databaseUrl);
  return createPglite(opts.pgliteDataDir ?? null);
}
