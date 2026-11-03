import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Database } from './database';

/**
 * Exécuteur de migrations pour une base PostgreSQL / Supabase réelle.
 * - applique, dans l'ordre, les fichiers de supabase/migrations non encore appliqués, chacun dans
 *   une transaction ;
 * - enregistre chaque migration avec son empreinte SHA-256 et REFUSE de continuer si une
 *   migration déjà appliquée a été modifiée (une migration publiée ne se réécrit pas) ;
 * - charge supabase/seed.sql (idempotent : « on conflict ») ;
 * - n'applique jamais supabase/local/ (réservé au développement).
 */
export interface MigrationReport { applied: string[]; alreadyApplied: number; seeded: boolean }

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export async function migrate(db: Database, root: string, opts: { seed?: boolean; log?: (m: string) => void } = {}): Promise<MigrationReport> {
  const log = opts.log ?? (() => undefined);
  await db.exec(`create schema if not exists app_migrations;
    create table if not exists app_migrations.applied (name text primary key, sha256 char(64) not null, applied_at timestamptz not null default now());`);
  const dir = join(root, 'supabase', 'migrations');
  const files = readdirSync(dir).filter((f) => /^\d{14}_[a-z0-9_]+\.sql$/.test(f)).sort();
  const done = new Map((await db.query<{ name: string; sha256: string }>(`select name, sha256 from app_migrations.applied`)).map((r) => [r.name, r.sha256]));
  const applied: string[] = [];
  for (const f of files) {
    const sql = readFileSync(join(dir, f), 'utf8');
    const prev = done.get(f);
    if (prev) {
      if (prev !== sha(sql)) throw new Error(`La migration déjà appliquée ${f} a été modifiée : créez une nouvelle migration au lieu de la réécrire.`);
      continue;
    }
    log(`application de ${f}`);
    // begin/commit explicites : une migration échouée n'est jamais appliquée à moitié.
    await db.exec(`begin;\n${sql}\n;\ninsert into app_migrations.applied (name, sha256) values ('${f}', '${sha(sql)}');\ncommit;`)
      .catch(async (e: Error) => { await db.exec('rollback;').catch(() => undefined); throw new Error(`Échec de ${f} : ${e.message}`); });
    applied.push(f);
  }
  let seeded = false;
  if (opts.seed !== false) {
    log('chargement de seed.sql');
    await db.exec(readFileSync(join(root, 'supabase', 'seed.sql'), 'utf8'));
    seeded = true;
  }
  return { applied, alreadyApplied: done.size, seeded };
}
