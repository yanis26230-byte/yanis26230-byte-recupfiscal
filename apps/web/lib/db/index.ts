import 'server-only';
import { createDatabase, type Database } from './database';

const g = globalThis as unknown as { __rfDb?: Promise<Database> };

/** Connexion unique par processus serveur (Supabase/PostgreSQL si DATABASE_URL, sinon PGlite local). */
export function getDb(): Promise<Database> {
  g.__rfDb ??= createDatabase({ databaseUrl: process.env.DATABASE_URL, pgliteDataDir: process.env.PGLITE_DATA_DIR ?? '.data/pglite' });
  return g.__rfDb;
}
