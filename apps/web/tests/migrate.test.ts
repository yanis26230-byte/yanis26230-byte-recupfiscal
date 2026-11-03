import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '@/lib/db/database';
import { migrate } from '@/lib/db/migrate';

function repoCopy() {
  const dir = mkdtempSync(join(tmpdir(), 'rf-mig-'));
  cpSync(join(repoRoot(), 'supabase'), join(dir, 'supabase'), { recursive: true });
  return dir;
}

async function emptyDb() {
  // PGlite neuf avec le seul socle Supabase (schémas auth et storage), sans aucune migration.
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = new PGlite();
  await pg.exec(readFileSync(join(repoRoot(), 'supabase/local/supabase-stub.sql'), 'utf8'));
  return {
    query: async <T,>(sql: string, params?: unknown[]) => (await pg.query(sql, params)).rows as T[],
    exec: async (sql: string) => { await pg.exec(sql); },
    transaction: async () => { throw new Error('non utilisé'); },
    asUser: async () => { throw new Error('non utilisé'); },
    close: () => pg.close(),
  };
}

describe('Exécuteur de migrations (base réelle)', () => {
  it('applique toutes les migrations puis le seed sur une base Supabase neuve, puis ne refait rien', async () => {
    const db = await emptyDb();
    const r1 = await migrate(db as never, repoRoot());
    expect(r1.applied.length).toBeGreaterThanOrEqual(10);
    expect(r1.seeded).toBe(true);
    const [t] = await db.query<{ n: number }>(`select count(*)::int as n from information_schema.tables where table_schema = 'public'`);
    expect(t!.n).toBeGreaterThan(35);
    const [m] = await db.query<{ n: number }>(`select count(*)::int as n from public.modules`);
    expect(m!.n).toBe(5);
    const r2 = await migrate(db as never, repoRoot());
    expect(r2).toEqual({ applied: [], alreadyApplied: r1.applied.length, seeded: true });
    await db.close();
  }, 120_000);

  it('refuse de continuer si une migration déjà appliquée a été réécrite', async () => {
    const root = repoCopy();
    const db = await emptyDb();
    await migrate(db as never, root, { seed: false });
    const f = join(root, 'supabase/migrations/20261102000001_schema.sql');
    writeFileSync(f, readFileSync(f, 'utf8') + '\n-- modification après coup\n');
    await expect(migrate(db as never, root, { seed: false })).rejects.toThrow(/a été modifiée/);
    await db.close();
  }, 120_000);

  it('une migration en échec n’est jamais appliquée à moitié', async () => {
    const root = repoCopy();
    const db = await emptyDb();
    await migrate(db as never, root, { seed: false });
    writeFileSync(join(root, 'supabase/migrations/20991231000001_casse.sql'), 'create table public.temoin (id int);\nselect * from table_inexistante;\n');
    await expect(migrate(db as never, root, { seed: false })).rejects.toThrow(/Échec de 20991231000001_casse.sql/);
    expect(await db.query(`select 1 from information_schema.tables where table_name = 'temoin'`)).toHaveLength(0);
    expect(await db.query(`select 1 from app_migrations.applied where name = '20991231000001_casse.sql'`)).toHaveLength(0);
    await db.close();
  }, 120_000);
});
